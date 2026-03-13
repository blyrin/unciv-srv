//go:build dev

package router

import (
	"io/fs"
	"os"
	"path/filepath"
)

func getWebFS() (fs.FS, error) {
	return os.DirFS(filepath.Join("internal", "router", "web")), nil
}
