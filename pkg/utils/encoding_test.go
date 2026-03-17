package utils

import (
	"encoding/json"
	"testing"
)

func TestDecodeEncodeRoundTrip(t *testing.T) {
	original := json.RawMessage(`{"gameId":"test","turns":5}`)

	encoded, err := EncodeFile(original)
	if err != nil {
		t.Fatalf("EncodeFile 失败: %v", err)
	}

	decoded, err := DecodeFile(encoded)
	if err != nil {
		t.Fatalf("DecodeFile 失败: %v", err)
	}

	// 比较 JSON 内容
	var orig, dec map[string]any
	json.Unmarshal(original, &orig)
	json.Unmarshal(decoded, &dec)

	if orig["gameId"] != dec["gameId"] || orig["turns"] != dec["turns"] {
		t.Errorf("往返数据不一致: 原始=%s, 解码=%s", original, decoded)
	}
}

func TestDecodeFile_Empty(t *testing.T) {
	_, err := DecodeFile("")
	if err == nil {
		t.Error("空字符串应返回错误")
	}
}

func TestDecodeFile_InvalidBase64(t *testing.T) {
	_, err := DecodeFile("!@#$%^&*()")
	if err == nil {
		t.Error("无效 base64 应返回错误")
	}
}

func TestDecodeFile_InvalidGzip(t *testing.T) {
	// 有效 base64 但不是 gzip
	_, err := DecodeFile("aGVsbG8=")
	if err == nil {
		t.Error("非 gzip 数据应返回错误")
	}
}

func TestValidateGameID(t *testing.T) {
	tests := map[string]struct {
		input string
		want  bool
	}{
		"有效UUID":      {input: "12345678-1234-1234-1234-123456789012", want: true},
		"有效Preview":   {input: "12345678-1234-1234-1234-123456789012_Preview", want: true},
		"空字符串":        {input: "", want: false},
		"大写字母":        {input: "12345678-1234-1234-1234-12345678901A", want: false},
		"长度不对":        {input: "1234", want: false},
		"错误后缀":        {input: "12345678-1234-1234-1234-123456789012_Other", want: false},
		"缺少连字符":       {input: "123456781234123412341234567890123", want: false},
		"有效UUID小写hex": {input: "abcdef01-2345-6789-abcd-ef0123456789", want: true},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			got := ValidateGameID(tt.input)
			if got != tt.want {
				t.Errorf("ValidateGameID(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestValidatePlayerID(t *testing.T) {
	tests := map[string]struct {
		input string
		want  bool
	}{
		"有效UUID":      {input: "12345678-1234-1234-1234-123456789012", want: true},
		"空字符串":        {input: "", want: false},
		"Preview后缀":   {input: "12345678-1234-1234-1234-123456789012_Preview", want: false},
		"非UUID":       {input: "not-a-uuid", want: false},
		"大写":          {input: "ABCDEF01-2345-6789-ABCD-EF0123456789", want: false},
		"有效UUID小写hex": {input: "abcdef01-2345-6789-abcd-ef0123456789", want: true},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			got := ValidatePlayerID(tt.input)
			if got != tt.want {
				t.Errorf("ValidatePlayerID(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestIsPreviewID(t *testing.T) {
	tests := map[string]struct {
		input string
		want  bool
	}{
		"Preview后缀": {input: "12345678-1234-1234-1234-123456789012_Preview", want: true},
		"普通UUID":    {input: "12345678-1234-1234-1234-123456789012", want: false},
		"空字符串":      {input: "", want: false},
		"仅_Preview": {input: "_Preview", want: false},
		"短字符串加后缀":   {input: "short_Preview", want: true},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			got := IsPreviewID(tt.input)
			if got != tt.want {
				t.Errorf("IsPreviewID(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestGetBaseGameID(t *testing.T) {
	tests := map[string]struct {
		input string
		want  string
	}{
		"有Preview后缀": {
			input: "12345678-1234-1234-1234-123456789012_Preview",
			want:  "12345678-1234-1234-1234-123456789012",
		},
		"无Preview后缀": {
			input: "12345678-1234-1234-1234-123456789012",
			want:  "12345678-1234-1234-1234-123456789012",
		},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			got := GetBaseGameID(tt.input)
			if got != tt.want {
				t.Errorf("GetBaseGameID(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestParseGameData(t *testing.T) {
	data := json.RawMessage(`{
		"gameId": "12345678-1234-1234-1234-123456789012",
		"turns": 10,
		"gameParameters": {
			"players": [
				{"playerId": "00000000-0000-0000-0000-000000000001", "playerType": "Human"},
				{"playerId": "ai-player", "playerType": "AI"}
			]
		}
	}`)

	gameData, err := ParseGameData(data)
	if err != nil {
		t.Fatalf("ParseGameData 失败: %v", err)
	}

	if gameData.GameID != "12345678-1234-1234-1234-123456789012" {
		t.Errorf("GameID = %q, want %q", gameData.GameID, "12345678-1234-1234-1234-123456789012")
	}
	if gameData.Turns != 10 {
		t.Errorf("Turns = %d, want 10", gameData.Turns)
	}
	if gameData.GameParameters == nil || len(gameData.GameParameters.Players) != 2 {
		t.Errorf("Players 数量不正确")
	}
}

func TestParseGameData_InvalidJSON(t *testing.T) {
	_, err := ParseGameData(json.RawMessage(`invalid`))
	if err == nil {
		t.Error("无效 JSON 应返回错误")
	}
}

func TestGetPlayerIDsFromGameData(t *testing.T) {
	data := json.RawMessage(`{
		"gameId": "test",
		"turns": 1,
		"gameParameters": {
			"players": [
				{"playerId": "00000000-0000-0000-0000-000000000001", "playerType": "Human"},
				{"playerId": "00000000-0000-0000-0000-000000000002", "playerType": "Human"},
				{"playerId": "ai-player", "playerType": "AI"},
				{"playerId": "", "playerType": "Human"}
			]
		}
	}`)

	ids, err := GetPlayerIDsFromGameData(data)
	if err != nil {
		t.Fatalf("GetPlayerIDsFromGameData 失败: %v", err)
	}

	if len(ids) != 2 {
		t.Fatalf("期望 2 个人类玩家ID，得到 %d", len(ids))
	}
	if ids[0] != "00000000-0000-0000-0000-000000000001" || ids[1] != "00000000-0000-0000-0000-000000000002" {
		t.Errorf("玩家ID不正确: %v", ids)
	}
}

func TestGetPlayerIDsFromGameData_NoParameters(t *testing.T) {
	data := json.RawMessage(`{"gameId": "test", "turns": 1}`)
	ids, err := GetPlayerIDsFromGameData(data)
	if err != nil {
		t.Fatalf("GetPlayerIDsFromGameData 失败: %v", err)
	}
	if len(ids) != 0 {
		t.Errorf("期望 0 个玩家ID，得到 %d", len(ids))
	}
}

func TestGenerateRandomStr(t *testing.T) {
	s1 := GenerateRandomStr(16)
	s2 := GenerateRandomStr(16)

	if len(s1) != 16 {
		t.Errorf("长度 = %d, want 16", len(s1))
	}
	if s1 == s2 {
		t.Error("两次生成的随机字符串不应相同")
	}

	// 长度为 0
	s0 := GenerateRandomStr(0)
	if len(s0) != 0 {
		t.Errorf("长度0: 得到 %d", len(s0))
	}
}
