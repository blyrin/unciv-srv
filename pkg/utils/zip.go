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
		// 将 JSON 数据编码为游戏存档格式（Base64 + Gzip）
		encoded, err := EncodeFile(entry.Data)
		if err != nil {
			return nil, fmt.Errorf("编码文件 %s 失败: %w", entry.Name, err)
		}

		f, err := w.Create(entry.Name)
		if err != nil {
			return nil, fmt.Errorf("创建ZIP条目 %s 失败: %w", entry.Name, err)
		}

		if _, err := f.Write([]byte(encoded)); err != nil {
			return nil, fmt.Errorf("写入ZIP条目 %s 失败: %w", entry.Name, err)
		}
	}

	if err := w.Close(); err != nil {
		return nil, fmt.Errorf("关闭ZIP文件失败: %w", err)
	}

	return buf.Bytes(), nil
}

// CreateZipRaw 创建 ZIP 压缩包（原始数据，不编码）
func CreateZipRaw(entries map[string][]byte) ([]byte, error) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)

	for name, data := range entries {
		f, err := w.Create(name)
		if err != nil {
			return nil, fmt.Errorf("创建ZIP条目 %s 失败: %w", name, err)
		}

		if _, err := f.Write(data); err != nil {
			return nil, fmt.Errorf("写入ZIP条目 %s 失败: %w", name, err)
		}
	}

	if err := w.Close(); err != nil {
		return nil, fmt.Errorf("关闭ZIP文件失败: %w", err)
	}

	return buf.Bytes(), nil
}
