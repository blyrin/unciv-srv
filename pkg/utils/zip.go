package utils

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
)

// FileEntry ZIP 文件条目
type FileEntry struct {
	Name string
	Data json.RawMessage
}

// CreateZip 创建 ZIP 压缩包
func CreateZip(entries []FileEntry) ([]byte, error) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)

	for _, entry := range entries {
		f, err := w.Create(entry.Name)
		if err != nil {
			return nil, fmt.Errorf("创建ZIP条目 %s 失败: %w", entry.Name, err)
		}
		if _, err := f.Write(entry.Data); err != nil {
			return nil, fmt.Errorf("写入ZIP条目 %s 失败: %w", entry.Name, err)
		}
	}

	if err := w.Close(); err != nil {
		return nil, fmt.Errorf("关闭ZIP文件失败: %w", err)
	}

	return buf.Bytes(), nil
}
