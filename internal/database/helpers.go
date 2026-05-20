package database

import "strings"

// deref 解引用 *string，nil 时返回空字符串
func deref(p *string) string {
	if p != nil {
		return *p
	}
	return ""
}

// buildInClause 构建 SQL IN 子句的占位符和参数
func buildInClause(ids []string) (string, []any) {
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	return strings.Join(placeholders, ", "), args
}
