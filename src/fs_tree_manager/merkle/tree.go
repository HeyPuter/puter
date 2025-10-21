package merkle

import (
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/cespare/xxhash/v2"
	pb "github.com/puter/fs_tree_manager/go"
)

// Tree represents a Merkle tree with thread-safe access
type Tree struct {
	tree *pb.MerkleTree
	lock sync.RWMutex

	// Last time the tree was synced from database
	LastSynced time.Time

	// Last time the tree was read (by FetchReplica/PullDiff)
	LastRead time.Time
}

// NewTree creates a new MerkleTree instance
func NewTree(tree *pb.MerkleTree) *Tree {
	return &Tree{
		tree:       tree,
		LastSynced: time.Now(),
	}
}

// GetTree returns the underlying MerkleTree
func (t *Tree) GetTree() *pb.MerkleTree {
	return t.tree
}

// RLock acquires a read lock
func (t *Tree) RLock() {
	t.lock.RLock()
}

// RUnlock releases a read lock
func (t *Tree) RUnlock() {
	t.lock.RUnlock()
}

// Lock acquires a write lock
func (t *Tree) Lock() {
	t.lock.Lock()
}

// Unlock releases a write lock
func (t *Tree) Unlock() {
	t.lock.Unlock()
}

// CalculateHash calculates the MerkleHash for a node based on its attributes and children hashes
func CalculateHash(node *pb.MerkleNode, childrenHashes []string) string {
	hasher := xxhash.New()

	if node.FsEntry.Metadata != nil {
		metadataBytes, err := json.Marshal(node.FsEntry.Metadata.AsMap())
		if err == nil {
			hasher.Write(metadataBytes)
		}
	}

	sort.Strings(childrenHashes)

	for _, childHash := range childrenHashes {
		hasher.WriteString(childHash)
	}

	hash := hasher.Sum64()
	hashStr := fmt.Sprintf("%d", hash)
	return hashStr
}

// CalculateTreeHashes calculates MerkleHash for all nodes in the tree using a bottom-up approach
func CalculateTreeHashes(tree *pb.MerkleTree) {
	// Track which nodes have been processed
	processed := make(map[string]bool)

	// First pass: calculate hashes for leaf nodes (nodes with no children)
	for _, node := range tree.Nodes {
		if len(node.ChildrenUuids) == 0 {
			node.MerkleHash = CalculateHash(node, []string{})
			processed[node.Uuid] = true
		}
	}

	// Continue processing until all nodes are done
	for {
		progressMade := false

		// Process nodes whose children are all processed
		for _, node := range tree.Nodes {
			if processed[node.Uuid] {
				continue
			}

			// Check if all children have been processed
			allChildrenReady := true
			childrenHashes := make([]string, 0, len(node.ChildrenUuids))

			for childID := range node.ChildrenUuids {
				if child, exists := tree.Nodes[childID]; exists {
					if !processed[childID] {
						allChildrenReady = false
						break
					}
					if child.MerkleHash != "" {
						childrenHashes = append(childrenHashes, child.MerkleHash)
					}
				}
			}

			// If all children are ready, calculate this node's hash
			if allChildrenReady {
				node.MerkleHash = CalculateHash(node, childrenHashes)
				processed[node.Uuid] = true
				progressMade = true
			}
		}

		// If no progress was made, we're done
		if !progressMade {
			break
		}
	}
}

// RecalculateAncestorHashes recalculates Merkle hashes for all ancestors of a given node
func RecalculateAncestorHashes(tree *pb.MerkleTree, nodeID string) {
	currentNodeID := nodeID

	for currentNodeID != "" {
		currentNode, exists := tree.Nodes[currentNodeID]
		if !exists {
			break
		}

		childrenHashes := make([]string, 0, len(currentNode.ChildrenUuids))
		for childID := range currentNode.ChildrenUuids {
			if child, exists := tree.Nodes[childID]; exists && child.MerkleHash != "" {
				childrenHashes = append(childrenHashes, child.MerkleHash)
			}
		}

		currentNode.MerkleHash = CalculateHash(currentNode, childrenHashes)

		currentNodeID = currentNode.ParentUuid
	}
}

// GetAllDescendants collects all descendant UUIDs of a given node
func GetAllDescendants(nodeUUID string, nodes map[string]*pb.MerkleNode, descendants map[string]bool) {
	node, exists := nodes[nodeUUID]
	if !exists {
		return
	}

	for childUUID := range node.ChildrenUuids {
		descendants[childUUID] = true
		GetAllDescendants(childUUID, nodes, descendants)
	}
}
