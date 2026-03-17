package utils

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"testing"
)

func TestCreateZip_SingleFile(t *testing.T) {
	entries := []FileEntry{
		{Name: "test.json", Data: json.RawMessage(`{"key":"value"}`)},
	}

	data, err := CreateZip(entries)
	if err != nil {
		t.Fatalf("CreateZip 失败: %v", err)
	}

	// 验证可以被 archive/zip 读取
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("读取 ZIP 失败: %v", err)
	}

	if len(reader.File) != 1 {
		t.Fatalf("ZIP 文件数量 = %d, want 1", len(reader.File))
	}
	if reader.File[0].Name != "test.json" {
		t.Errorf("文件名 = %q, want %q", reader.File[0].Name, "test.json")
	}
}

func TestCreateZip_MultipleFiles(t *testing.T) {
	entries := []FileEntry{
		{Name: "a.json", Data: json.RawMessage(`{"a":1}`)},
		{Name: "b.json", Data: json.RawMessage(`{"b":2}`)},
		{Name: "c.json", Data: json.RawMessage(`{"c":3}`)},
	}

	data, err := CreateZip(entries)
	if err != nil {
		t.Fatalf("CreateZip 失败: %v", err)
	}

	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("读取 ZIP 失败: %v", err)
	}

	if len(reader.File) != 3 {
		t.Fatalf("ZIP 文件数量 = %d, want 3", len(reader.File))
	}

	names := make(map[string]bool)
	for _, f := range reader.File {
		names[f.Name] = true
	}
	for _, name := range []string{"a.json", "b.json", "c.json"} {
		if !names[name] {
			t.Errorf("缺少文件 %q", name)
		}
	}
}

func TestCreateZip_Empty(t *testing.T) {
	data, err := CreateZip(nil)
	if err != nil {
		t.Fatalf("CreateZip 失败: %v", err)
	}

	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("读取空 ZIP 失败: %v", err)
	}
	if len(reader.File) != 0 {
		t.Errorf("空 ZIP 文件数量 = %d, want 0", len(reader.File))
	}
}
