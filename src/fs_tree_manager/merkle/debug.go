package merkle

import (
	"fmt"
	"log"
	"sort"
	"strings"

	pb "github.com/puter/fs_tree_manager/go"
)

var (
	// ignoreDirs contains directories to ignore when printing the tree
	ignoreDirs = []string{
		"/admin/api_test",
		"/admin/Trash",
	}
)

// IntegrityCheck validates the integrity of all trees in the provided map
func IntegrityCheck(globalTrees map[int64]*Tree) {
	for userID, wrappedTree := range globalTrees {
		tree := wrappedTree.GetTree()

		root, exists := tree.Nodes[tree.RootUuid]
		if !exists {
			log.Panicf("[user %d] root uuid not found: %s", userID, tree.RootUuid)
		}
		rootPath := root.FsEntry.Metadata.AsMap()["path"].(string)

		for UUID, node := range tree.Nodes {
			// check: uuid is consistent
			if UUID != node.Uuid {
				log.Panicf("[user %d] uuid is inconsistent: %s != %s", userID, UUID, node.Uuid)
			}

			// check with parent
			if node.Uuid != tree.RootUuid {
				// check: all node should have a parent
				if node.ParentUuid == "" {
					log.Panicf("[user %d] parent uuid is empty: %s", userID, node.Uuid)
				}

				// check: parent uuid is valid
				parent, exists := tree.Nodes[node.ParentUuid]
				if !exists {
					log.Panicf("[user %d] parent uuid not found: %s", userID, node.ParentUuid)
				}

				// check: parent has self as a child
				if !parent.ChildrenUuids[node.Uuid] {
					log.Panicf("[user %d] parent has self as a child: %s", userID, node.Uuid)
				}

				// check: parent path is a prefix
				parentPath := parent.FsEntry.Metadata.AsMap()["path"].(string)
				if !strings.HasPrefix(parentPath, rootPath) {
					log.Panicf("[user %d] parent path is not a prefix: %s", userID, parentPath)
				}
			}

			// check with children
			for childUUID := range node.ChildrenUuids {
				// check: child uuid is valid
				if _, exists := tree.Nodes[childUUID]; !exists {
					PrintTree(tree)
					log.Panicf("[user %d] child uuid not found: %s", userID, childUUID)
				}
			}
		}
	}
}

// PrintTree prints the tree in a human-readable format, from the root to the leaves
func PrintTree(tree *pb.MerkleTree) {
	if tree == nil || tree.RootUuid == "" {
		fmt.Println("(empty tree)")
		return
	}

	rootNode, exists := tree.Nodes[tree.RootUuid]
	if !exists {
		fmt.Printf("(root node not found: %s)\n", tree.RootUuid)
		return
	}

	// Print tree header
	fmt.Printf("Merkle Tree (Root: %s)\n", tree.RootUuid)
	fmt.Println("├── " + getNodeDisplay(rootNode))

	// Print children recursively
	printNodeChildren(tree, rootNode, "│   ")
}

// printNodeChildren recursively prints children of a node
func printNodeChildren(tree *pb.MerkleTree, node *pb.MerkleNode, prefix string) {
	children := node.ChildrenUuids
	if len(children) == 0 {
		return
	}

	// Sort children by path for consistent display
	sortedChildren := make([]string, 0, len(children))
	for childUUID := range children {
		sortedChildren = append(sortedChildren, childUUID)
	}

	// Sort by path for better readability
	sort.Slice(sortedChildren, func(i, j int) bool {
		childI, existsI := tree.Nodes[sortedChildren[i]]
		childJ, existsJ := tree.Nodes[sortedChildren[j]]
		if !existsI || !existsJ {
			return sortedChildren[i] < sortedChildren[j]
		}

		pathI := getPath(childI)
		pathJ := getPath(childJ)
		return pathI < pathJ
	})

	for i, childUUID := range sortedChildren {
		childNode, exists := tree.Nodes[childUUID]
		if !exists {
			fmt.Printf("%s├── [MISSING NODE: %s]\n", prefix, childUUID)
			continue
		}

		// Check if this child should be ignored
		childPath := getPath(childNode)
		shouldIgnore := false
		for _, ignoreDir := range ignoreDirs {
			if childPath == ignoreDir {
				shouldIgnore = true
				break
			}
		}

		if shouldIgnore {
			continue
		}

		isLast := i == len(sortedChildren)-1
		var currentPrefix, nextPrefix string

		if isLast {
			currentPrefix = "└── "
			nextPrefix = "    "
		} else {
			currentPrefix = "├── "
			nextPrefix = "│   "
		}

		fmt.Printf("%s%s%s\n", prefix, currentPrefix, getNodeDisplay(childNode))

		// Recursively print children
		printNodeChildren(tree, childNode, prefix+nextPrefix)
	}
}

// getNodeDisplay returns a formatted string for displaying a node
func getNodeDisplay(node *pb.MerkleNode) string {
	path := getPath(node)
	name := getName(node)

	// Truncate UUID to first 8 characters for readability
	shortUUID := node.Uuid
	if len(shortUUID) > 8 {
		shortUUID = shortUUID[:8]
	}

	return fmt.Sprintf("%s [%s] (uuid: %s)", path, name, shortUUID)
}

// getPath extracts the path from node metadata
func getPath(node *pb.MerkleNode) string {
	if node.FsEntry == nil || node.FsEntry.Metadata == nil {
		return "[no path]"
	}

	metadata := node.FsEntry.Metadata.AsMap()
	if path, ok := metadata["path"].(string); ok {
		return path
	}
	return "[no path]"
}

// getName extracts the name from node metadata
func getName(node *pb.MerkleNode) string {
	if node.FsEntry == nil || node.FsEntry.Metadata == nil {
		return "[no name]"
	}

	metadata := node.FsEntry.Metadata.AsMap()
	if name, ok := metadata["name"].(string); ok {
		return name
	}
	return "[no name]"
}
