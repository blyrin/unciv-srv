package main

// 版本信息
// 在编译时通过 -ldflags 注入
// 示例: go build -ldflags="-X main.Version=v1.0.0 -X main.BuildTime=2025-12-05T10:30:00Z"
var (
	Version   = "dev"      // 版本号
	BuildTime = "unknown"  // 编译时间
	GitCommit = "unknown"  // Git 提交哈希
)

// VersionInfo 返回版本信息字符串
func VersionInfo() string {
	return "Unciv-Srv " + Version + " (构建时间: " + BuildTime + ", 提交: " + GitCommit + ")"
}
