package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"math/rand"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/mattn/go-sqlite3"
	pb "github.com/puter/fs_tree_manager/go"
	"github.com/puter/fs_tree_manager/merkle"
	"github.com/spf13/cobra"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/structpb"
	"gopkg.in/yaml.v3"
)

type (
	server struct {
		pb.UnimplementedFSTreeManagerServer
		db *sql.DB
	}

	// Config represents the application configuration
	Config struct {
		Database struct {
			Driver  string `yaml:"driver"`
			SQLite3 struct {
				Path string `yaml:"path"`
			} `yaml:"sqlite3"`
			MySQL struct {
				Host     string `yaml:"db_host"`
				Port     int    `yaml:"db_port"`
				User     string `yaml:"db_user"`
				Password string `yaml:"db_password"`
				Database string `yaml:"db_database"`
			} `yaml:"mysql"`
		} `yaml:"database"`
		Server struct {
			Port int `yaml:"port"`
		} `yaml:"server"`
	}
)

var (
	// key: user_id, value: user's full replica FS tree
	globalTrees map[int64]*merkle.Tree

	// This is only used to protect the integrity of the globalTrees map. Each
	// tree's integrity is not its responsibility.
	globalTreesLock sync.RWMutex

	// Memory threshold in bytes (2GB)
	memoryThresholdBytes int64 = 2 * 1024 * 1024 * 1024

	// Make FS-Tree Manager unstable and laggy.
	chaos = false

	debug = false
)

// checkMemoryUsage checks if the current memory usage exceeds the threshold
func checkMemoryUsage() error {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	if m.Alloc > uint64(memoryThresholdBytes) {
		return fmt.Errorf("memory usage (%d bytes) exceeds threshold (%d bytes)", m.Alloc, memoryThresholdBytes)
	}

	return nil
}

// Get a readable tree, initialize the tree from database if it doesn't exist.
func getReadableTree(s *server, userID int64) (*merkle.Tree, error) {
	globalTreesLock.RLock()
	lockedTree, exists := globalTrees[userID]
	globalTreesLock.RUnlock()

	if exists {
		lockedTree.RLock()
		lockedTree.LastRead = time.Now()
		return lockedTree, nil
	}

	if err := checkMemoryUsage(); err != nil {
		return nil, err
	}

	tree, err := s.buildUserFSTree(userID)
	if err != nil {
		return nil, err
	}

	lockedTree = merkle.NewTree(tree)
	globalTreesLock.Lock()
	globalTrees[userID] = lockedTree
	globalTreesLock.Unlock()

	lockedTree.RLock()
	return lockedTree, nil
}

// Get a read-write tree.
func getWritableTree(userID int64) (*merkle.Tree, error) {
	globalTreesLock.RLock()
	lockedTree, exists := globalTrees[userID]
	globalTreesLock.RUnlock()

	if exists {
		lockedTree.Lock()
		return lockedTree, nil
	}

	return nil, fmt.Errorf("tree for user %d does not exist in memory", userID)
}

// FetchReplica implements the FSTreeManager service
func (s *server) FetchReplica(ctx context.Context, req *pb.FetchReplicaRequest) (*pb.MerkleTree, error) {
	if chaos {
		time.Sleep(20 * time.Second)
	}

	readableTree, err := getReadableTree(s, req.UserId)
	if err != nil {
		return nil, err
	}
	defer readableTree.RUnlock()

	return readableTree.GetTree(), nil
}

func (s *server) PullDiff(ctx context.Context, req *pb.PullRequest) (*pb.PushRequest, error) {
	if chaos {
		if err := mayCrash(); err != nil {
			return nil, err
		}
	}

	lockedTree, err := getReadableTree(s, req.UserId)
	if err != nil {
		return nil, fmt.Errorf("[user %d] no cached tree found: %v", req.UserId, err)
	}
	defer lockedTree.RUnlock()

	tree := lockedTree.GetTree()
	response := &pb.PushRequest{
		UserId:      req.UserId,
		PushRequest: []*pb.PushRequestItem{},
	}

	for _, pullRequestItem := range req.PullRequest {
		node, exists := tree.Nodes[pullRequestItem.Uuid]
		if !exists {
			log.Printf("[user %d] node not found: %s", req.UserId, pullRequestItem.Uuid)
			continue
		}

		// If hashes match, no need to send this node.
		if node.MerkleHash == pullRequestItem.MerkleHash {
			continue
		}

		// Create push request item with node and its children.
		pushItem := &pb.PushRequestItem{
			Uuid:       node.Uuid,
			MerkleHash: node.MerkleHash,
			FsEntry:    node.FsEntry,
			Children:   []*pb.PushRequestItem{},
		}

		// Add all children.
		for childUUID := range node.ChildrenUuids {
			if childNode, childExists := tree.Nodes[childUUID]; childExists {
				childPushItem := &pb.PushRequestItem{
					Uuid:       childNode.Uuid,
					MerkleHash: childNode.MerkleHash,
					FsEntry:    childNode.FsEntry,
					Children:   []*pb.PushRequestItem{},
				}
				pushItem.Children = append(pushItem.Children, childPushItem)
			}
		}

		response.PushRequest = append(response.PushRequest, pushItem)
	}

	return response, nil
}

// NewFSEntry implements the FSTreeManager service
func (s *server) NewFSEntry(ctx context.Context, req *pb.NewFSEntryRequest) (*emptypb.Empty, error) {
	if chaos {
		if err := mayCrash(); err != nil {
			return nil, err
		}
	}

	userID := req.UserId
	fsEntry := req.FsEntry

	metadataMap := fsEntry.Metadata.AsMap()
	uid, ok := metadataMap["uid"].(string)
	if !ok {
		return nil, fmt.Errorf("invalid metadata: missing uid")
	}

	lockedTree, err := getWritableTree(userID)
	if err != nil {
		return nil, err
	}
	defer lockedTree.Unlock()

	parentUUID, err := getParentUUID(metadataMap, lockedTree.GetTree().Nodes)
	if err != nil {
		return nil, err
	}

	tree := lockedTree.GetTree()
	parentNode, exists := tree.Nodes[parentUUID]
	if !exists {
		return nil, fmt.Errorf("parent directory not found: %s", parentUUID)
	}

	newNode := &pb.MerkleNode{
		Uuid:          uid,
		MerkleHash:    "",
		ParentUuid:    parentUUID,
		FsEntry:       fsEntry,
		ChildrenUuids: make(map[string]bool),
	}

	tree.Nodes[uid] = newNode

	parentNode.ChildrenUuids[uid] = true

	newNode.MerkleHash = merkle.CalculateHash(newNode, []string{})

	merkle.RecalculateAncestorHashes(tree, uid)

	if debug {
		parentPath := parentNode.FsEntry.Metadata.AsMap()["path"].(string)
		parentUUID = parentNode.Uuid
		log.Printf("[user %d] new fs entry, (path: %s, uuid: %s), (parent_path: %s, parent_uuid: %s)", userID, metadataMap["path"], uid, parentPath, parentUUID)
		merkle.IntegrityCheck(globalTrees)
	}

	return &emptypb.Empty{}, nil
}

// TODO: remove this once parent_path is always consistent with parent_uuid
func getParentUUID(metadata map[string]any, nodes map[string]*pb.MerkleNode) (UUID string, err error) {
	// Check the inconsistency between "parent_path" and "parent_uuid", the inconsistency
	// occurs in several scenarios:
	// - When moving a directory from ~/Desktop to ~/trash, the parent_uuid is not updated.

	// parent_path comes from "dirpath" field
	parentPath := metadata["dirpath"].(string)

	// parent_uuid comes from "parent_uid"/"parent_id" field, just use parent_uid here.
	parentUUID := metadata["parent_uid"].(string)

	if parentUUID == "" {
		return "", fmt.Errorf("parent_uuid is empty")
	}

	parentNode, parentExists := nodes[parentUUID]
	if !parentExists {
		return "", fmt.Errorf("parent node not found, uuid: %s", parentUUID)
	}

	pathFromUUID := parentNode.FsEntry.Metadata.AsMap()["path"].(string)
	if parentPath != pathFromUUID {
		// When missmatch happens, use parentPath.
		log.Printf("parent_path(preferred) and parent_uuid mismatch, parent_path: %s, pathFromUUID: %s, uuid: %s", parentPath, pathFromUUID, parentUUID)
		return pathToUUID(parentPath, nodes)
	}

	return parentUUID, nil
}

func pathToUUID(path string, nodes map[string]*pb.MerkleNode) (UUID string, err error) {
	// TODO: optimize this by using a trie tree. Currently we cannot traverse the tree
	// using path.
	for _, node := range nodes {
		if node.FsEntry.Metadata.AsMap()["path"].(string) == path {
			return node.Uuid, nil
		}
	}
	return "", fmt.Errorf("node not found, path: %s", path)
}

// RemoveFSEntry implements the FSTreeManager service
func (s *server) RemoveFSEntry(ctx context.Context, req *pb.RemoveFSEntryRequest) (*emptypb.Empty, error) {
	if chaos {
		if err := mayCrash(); err != nil {
			return nil, err
		}
	}

	userID := req.UserId
	uid := req.Uuid
	if uid == "" {
		return nil, fmt.Errorf("invalid request: missing uuid")
	}

	lockedTree, err := getWritableTree(userID)
	if err != nil {
		return nil, err
	}
	defer lockedTree.Unlock()

	tree := lockedTree.GetTree()
	targetNode, exists := tree.Nodes[uid]
	if !exists {
		return nil, fmt.Errorf("entry not found: %s", uid)
	}

	// Collect all descendants to remove
	descendants := make(map[string]bool)
	merkle.GetAllDescendants(uid, tree.Nodes, descendants)

	// Remove the node from its parent's children map
	removedFromParent := false
	if targetNode.ParentUuid != "" {
		if parentNode, parentExists := tree.Nodes[targetNode.ParentUuid]; parentExists {
			if _, exists := parentNode.ChildrenUuids[uid]; exists {
				delete(parentNode.ChildrenUuids, uid)
				removedFromParent = true
			}
		}
	}
	if !removedFromParent {
		log.Panicf("[user %d] parent not found: %s", userID, targetNode.ParentUuid)
	}

	// Remove all descendants from the tree
	for descendantUUID := range descendants {
		delete(tree.Nodes, descendantUUID)
	}

	// Remove the node from the tree
	delete(tree.Nodes, uid)

	// Recalculate ancestor hashes
	if targetNode.ParentUuid != "" {
		merkle.RecalculateAncestorHashes(tree, targetNode.ParentUuid)
	}

	if debug {
		parent, parentExists := tree.Nodes[targetNode.ParentUuid]
		if !parentExists {
			log.Panicf("[user %d] parent not found: %s", userID, targetNode.ParentUuid)
		}
		parentPath := parent.FsEntry.Metadata.AsMap()["path"].(string)

		parentUUID := targetNode.ParentUuid
		log.Printf("[user %d] removed fs entry, (path: %s, uuid: %s), (parent_path: %s, parent_uuid: %s)", userID, targetNode.FsEntry.Metadata.AsMap()["path"], uid, parentPath, parentUUID)
		log.Printf("[user %d] removed descendants [%d]: %v", userID, len(descendants), descendants)
		merkle.IntegrityCheck(globalTrees)
	}

	return &emptypb.Empty{}, nil
}

func (s *server) PurgeReplica(ctx context.Context, req *pb.PurgeReplicaRequest) (*emptypb.Empty, error) {
	globalTreesLock.Lock()
	delete(globalTrees, req.UserId)
	globalTreesLock.Unlock()

	return &emptypb.Empty{}, nil
}

func mayCrash() error {
	v := rand.Intn(100)
	if v < 10 {
		panic("crash")
	} else if v < 30 {
		time.Sleep(10 * time.Second)
	} else if v < 60 {
		return fmt.Errorf("intentional error on chaos mode")
	}
	return nil
}

// loadConfig loads configuration from the specified config file
func loadConfig(configPath string) (*Config, error) {
	configData, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %v", err)
	}

	var config Config
	err = yaml.Unmarshal(configData, &config)
	if err != nil {
		return nil, fmt.Errorf("failed to parse config file: %v", err)
	}

	return &config, nil
}

// buildMetadata creates a comprehensive metadata structure matching the expected format
func buildMetadata(uuid, name, path, parentUID string, userID int64, isDir bool, size sql.NullInt64,
	createdAt, modifiedAt, accessedAt float64, isPublic, isShortcut, isSymlink sql.NullBool,
	symlinkPath, sortBy, sortOrder sql.NullString, immutable sql.NullBool,
	metadata, associatedAppID, publicToken, fileRequestToken sql.NullString) (*structpb.Struct, error) {

	dirname := filepath.Dir(path)
	dirpath := dirname

	isEmpty := true
	if isDir {
		isEmpty = !size.Valid || size.Int64 == 0
	}

	metadataMap := map[string]interface{}{
		"is_empty":           isEmpty,
		"id":                 uuid,
		"associated_app_id":  getStringValue(associatedAppID),
		"public_token":       getStringValue(publicToken),
		"file_request_token": getStringValue(fileRequestToken),
		"parent_uid":         parentUID,
		"is_dir":             isDir,
		"is_public":          getBoolValue(isPublic),
		"is_shortcut":        getIntValue(isShortcut),
		"is_symlink":         getIntValue(isSymlink),
		"symlink_path":       getStringValue(symlinkPath),
		"sort_by":            getStringValue(sortBy),
		"sort_order":         getStringValue(sortOrder),
		"immutable":          getIntValue(immutable),
		"name":               name,
		"metadata":           getStringValue(metadata),
		"modified":           int64(modifiedAt),
		"created":            int64(createdAt),
		"accessed":           int64(accessedAt),
		"size":               getInt64Value(size),
		"layout":             nil,
		"path":               path,
		"owner": map[string]interface{}{
			"user_id": userID,
		},
		"type":       nil,
		"subdomains": []interface{}{},
		"shares": map[string]interface{}{
			"users": []interface{}{},
			"apps":  []interface{}{},
		},
		"versions":  []interface{}{},
		"dirname":   dirname,
		"dirpath":   dirpath,
		"writable":  true,
		"parent_id": parentUID,
		"uid":       uuid,
	}

	return structpb.NewStruct(metadataMap)
}

func getStringValue(ns sql.NullString) interface{} {
	if ns.Valid {
		return ns.String
	}
	return nil
}

func getBoolValue(nb sql.NullBool) interface{} {
	if nb.Valid {
		return nb.Bool
	}
	return nil
}

func getIntValue(nb sql.NullBool) int {
	if nb.Valid && nb.Bool {
		return 1
	}
	return 0
}

func getInt64Value(ni sql.NullInt64) interface{} {
	if ni.Valid {
		return ni.Int64
	}
	return nil
}

// buildUserFSTree builds the filesystem tree for a given user from the database
func (s *server) buildUserFSTree(userID int64) (*pb.MerkleTree, error) {
	query := `
		SELECT uuid, name, is_dir, size, created, modified, path, parent_uid, 
		       is_public, is_shortcut, is_symlink, symlink_path, sort_by, sort_order,
		       immutable, metadata, accessed, associated_app_id, public_token, file_request_token
		FROM fsentries 
		WHERE user_id = ?
	`

	rows, err := s.db.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	nodes := make(map[string]*pb.MerkleNode)
	parentChildMap := make(map[string][]string)

	var rootUUID string

	for rows.Next() {
		var uuid, name, path string
		var parentUID sql.NullString
		var isDir bool
		var size sql.NullInt64
		var createdAt, modifiedAt float64
		var accessedAt sql.NullFloat64
		var isPublic, isShortcut, isSymlink, immutable sql.NullBool
		var symlinkPath, sortBy, sortOrder, metadata, associatedAppID, publicToken, fileRequestToken sql.NullString

		err := rows.Scan(&uuid, &name, &isDir, &size, &createdAt, &modifiedAt, &path, &parentUID,
			&isPublic, &isShortcut, &isSymlink, &symlinkPath, &sortBy, &sortOrder,
			&immutable, &metadata, &accessedAt, &associatedAppID, &publicToken, &fileRequestToken)
		if err != nil {
			continue
		}

		parentUIDStr := ""
		if parentUID.Valid {
			parentUIDStr = parentUID.String
		}

		accessedAtValue := float64(time.Now().Unix())
		if accessedAt.Valid {
			accessedAtValue = accessedAt.Float64
		}

		metadataStruct, err := buildMetadata(uuid, name, path, parentUIDStr, userID, isDir, size,
			createdAt, modifiedAt, accessedAtValue, isPublic, isShortcut, isSymlink,
			symlinkPath, sortBy, sortOrder, immutable, metadata, associatedAppID, publicToken, fileRequestToken)
		if err != nil {
			continue
		}

		node := &pb.MerkleNode{
			Uuid:          uuid,
			MerkleHash:    "",
			ParentUuid:    parentUIDStr,
			FsEntry:       &pb.FSEntry{Metadata: metadataStruct},
			ChildrenUuids: make(map[string]bool),
		}

		nodes[uuid] = node

		if parentUID.Valid {
			parentChildMap[parentUID.String] = append(parentChildMap[parentUID.String], uuid)
		}

		if strings.Count(path, "/") == 1 {
			rootUUID = uuid
		}
	}

	for parentUUID, childUUIDs := range parentChildMap {
		if parent, exists := nodes[parentUUID]; exists {
			parent.ChildrenUuids = make(map[string]bool)
			for _, childUUID := range childUUIDs {
				parent.ChildrenUuids[childUUID] = true
			}
		}
	}

	if rootUUID == "" {
		return nil, fmt.Errorf("[user %d] root directory not found", userID)
	}

	tree := &pb.MerkleTree{
		RootUuid: rootUUID,
		Nodes:    nodes,
	}

	merkle.CalculateTreeHashes(tree)

	return tree, nil
}

// purgeOldTrees removes trees that haven't been read in 1 minute or synced in 5 minutes
func purgeOldTrees() {
	globalTreesLock.Lock()
	defer globalTreesLock.Unlock()

	readCutoff := time.Now().Add(-1 * time.Minute)
	syncCutoff := time.Now().Add(-5 * time.Minute)
	var toDelete []int64

	for userID, lockedTree := range globalTrees {
		// Purge if either lastRead is older than 1 minute OR lastSynced is older than 5 minutes
		if lockedTree.LastRead.Before(readCutoff) || lockedTree.LastSynced.Before(syncCutoff) {
			toDelete = append(toDelete, userID)
		}
	}

	for _, userID := range toDelete {
		delete(globalTrees, userID)
	}
	log.Printf("purged %d old trees, %d trees remaining", len(toDelete), len(globalTrees))
}

// runServer starts the gRPC server with the given configuration
func runServer(configPath string) error {
	log.SetFlags(log.Ldate | log.Ltime | log.Lshortfile)

	// Load configuration
	config, err := loadConfig(configPath)
	if err != nil {
		return fmt.Errorf("failed to load config: %v", err)
	}

	globalTrees = make(map[int64]*merkle.Tree)

	// purge old trees periodically
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			purgeOldTrees()
		}
	}()

	var db *sql.DB
	var dbErr error

	if config.Database.Driver == "mysql" {
		// Validate MySQL configuration
		if config.Database.MySQL.Host == "" || config.Database.MySQL.User == "" ||
			config.Database.MySQL.Database == "" || config.Database.MySQL.Port == 0 {
			return fmt.Errorf("MySQL configuration is incomplete: host, user, database, and port are required")
		}

		// Build MySQL connection string
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=True&loc=Local",
			config.Database.MySQL.User,
			config.Database.MySQL.Password,
			config.Database.MySQL.Host,
			config.Database.MySQL.Port,
			config.Database.MySQL.Database,
		)
		db, dbErr = sql.Open("mysql", dsn)
	} else {
		// Default to SQLite
		if config.Database.SQLite3.Path == "" {
			return fmt.Errorf("SQLite3 configuration is incomplete: path is required")
		}
		db, dbErr = sql.Open(config.Database.Driver, config.Database.SQLite3.Path)
	}

	if dbErr != nil {
		return fmt.Errorf("failed to open database: %v", dbErr)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %v", err)
	}

	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", config.Server.Port))
	if err != nil {
		return fmt.Errorf("failed to listen: %v", err)
	}

	grpcServer := grpc.NewServer()

	pb.RegisterFSTreeManagerServer(grpcServer, &server{
		db: db,
	})

	log.Printf("server started on port %d", config.Server.Port)
	if err := grpcServer.Serve(lis); err != nil {
		return fmt.Errorf("failed to serve: %v", err)
	}

	return nil
}

func main() {
	var configPath string

	rootCmd := &cobra.Command{
		Use:   "fs-tree-manager",
		Short: "FS Tree Manager gRPC server",
		Long:  `A gRPC server that manages filesystem trees using Merkle trees for efficient synchronization.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runServer(configPath)
		},
	}

	rootCmd.Flags().StringVarP(&configPath, "config", "c", "./config.yaml", "Path to the configuration file")

	if err := rootCmd.Execute(); err != nil {
		log.Fatalf("Error: %v", err)
		os.Exit(1)
	}
}
