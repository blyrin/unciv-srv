//go:build !dev

package router

import (
	"embed"
	"io/fs"
)

//go:embed web
var webFS embed.FS

func getWebFS() (fs.FS, error) {
	return fs.Sub(webFS, "web")
}
