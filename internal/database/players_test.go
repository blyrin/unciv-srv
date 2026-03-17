package database

import (
	"context"
	"testing"
)

func TestCreateAndGetPlayer(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	err := CreatePlayer(ctx, testPlayerID1, testPassword, testIP)
	if err != nil {
		t.Fatalf("CreatePlayer 失败: %v", err)
	}

	player, err := GetPlayerByID(ctx, testPlayerID1)
	if err != nil {
		t.Fatalf("GetPlayerByID 失败: %v", err)
	}
	if player == nil {
		t.Fatal("玩家应存在")
	}
	if player.PlayerID != testPlayerID1 {
		t.Errorf("PlayerID = %q, want %q", player.PlayerID, testPlayerID1)
	}
	if player.Password != testPassword {
		t.Errorf("Password = %q, want %q", player.Password, testPassword)
	}
}

func TestGetPlayerByID_NotFound(t *testing.T) {
	setupTest(t)

	player, err := GetPlayerByID(context.Background(), "nonexistent")
	if err != nil {
		t.Fatalf("GetPlayerByID 失败: %v", err)
	}
	if player != nil {
		t.Error("不存在的玩家应返回 nil")
	}
}

func TestCreatePlayer_Duplicate(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	err := CreatePlayer(ctx, testPlayerID1, testPassword, testIP)
	if err != nil {
		t.Fatalf("第一次创建失败: %v", err)
	}

	err = CreatePlayer(ctx, testPlayerID1, "other", testIP)
	if err == nil {
		t.Error("重复创建应返回错误")
	}
}

func TestUpdatePlayerPassword(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)

	err := UpdatePlayerPassword(ctx, testPlayerID1, "newpass123", "1.2.3.4")
	if err != nil {
		t.Fatalf("UpdatePlayerPassword 失败: %v", err)
	}

	player, _ := GetPlayerByID(ctx, testPlayerID1)
	if player.Password != "newpass123" {
		t.Errorf("密码未更新: %q", player.Password)
	}
}

func TestGetAllPlayers(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedPlayer(t, testPlayerID2, testPassword)

	players, err := GetAllPlayers(ctx)
	if err != nil {
		t.Fatalf("GetAllPlayers 失败: %v", err)
	}
	if len(players) != 2 {
		t.Errorf("玩家数量 = %d, want 2", len(players))
	}
}

func TestUpdatePlayerInfo(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)

	err := UpdatePlayerInfo(ctx, testPlayerID1, true, "测试备注")
	if err != nil {
		t.Fatalf("UpdatePlayerInfo 失败: %v", err)
	}

	player, _ := GetPlayerByID(ctx, testPlayerID1)
	if !player.Whitelist {
		t.Error("Whitelist 应为 true")
	}
	if player.Remark != "测试备注" {
		t.Errorf("Remark = %q, want %q", player.Remark, "测试备注")
	}
}

func TestGetPlayerPassword(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)

	pwd, err := GetPlayerPassword(ctx, testPlayerID1)
	if err != nil {
		t.Fatalf("GetPlayerPassword 失败: %v", err)
	}
	if pwd != testPassword {
		t.Errorf("Password = %q, want %q", pwd, testPassword)
	}

	// 不存在的玩家
	pwd, err = GetPlayerPassword(ctx, "nonexistent")
	if err != nil {
		t.Fatalf("GetPlayerPassword 失败: %v", err)
	}
	if pwd != "" {
		t.Error("不存在的玩家密码应为空")
	}
}

func TestBatchUpdatePlayersWhitelist(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedPlayer(t, testPlayerID2, testPassword)
	seedPlayer(t, testPlayerID3, testPassword)

	err := BatchUpdatePlayersWhitelist(ctx, []string{testPlayerID1, testPlayerID2}, true)
	if err != nil {
		t.Fatalf("BatchUpdatePlayersWhitelist 失败: %v", err)
	}

	p1, _ := GetPlayerByID(ctx, testPlayerID1)
	p2, _ := GetPlayerByID(ctx, testPlayerID2)
	p3, _ := GetPlayerByID(ctx, testPlayerID3)

	if !p1.Whitelist || !p2.Whitelist {
		t.Error("p1 和 p2 应在白名单中")
	}
	if p3.Whitelist {
		t.Error("p3 不应在白名单中")
	}

	// 空列表不报错
	err = BatchUpdatePlayersWhitelist(ctx, nil, true)
	if err != nil {
		t.Errorf("空列表不应报错: %v", err)
	}
}

func TestUpdatePlayerLastActive(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)

	err := UpdatePlayerLastActive(ctx, testPlayerID1, "10.0.0.1")
	if err != nil {
		t.Fatalf("UpdatePlayerLastActive 失败: %v", err)
	}

	player, _ := GetPlayerByID(ctx, testPlayerID1)
	if player.UpdateIP != "10.0.0.1" {
		t.Errorf("UpdateIP = %q, want %q", player.UpdateIP, "10.0.0.1")
	}
}

func TestGetPlayersPage(t *testing.T) {
	setupTest(t)
	ctx := context.Background()

	seedPlayer(t, testPlayerID1, testPassword)
	seedPlayer(t, testPlayerID2, testPassword)
	seedPlayer(t, testPlayerID3, testPassword)

	// 设置备注方便搜索测试
	_ = UpdatePlayerInfo(ctx, testPlayerID1, false, "管理员测试")
	_ = UpdatePlayerInfo(ctx, testPlayerID2, true, "普通玩家")

	// 测试无关键字分页
	result, err := GetPlayersPage(ctx, "", 1, 2)
	if err != nil {
		t.Fatalf("GetPlayersPage 失败: %v", err)
	}
	if result.Total != 3 {
		t.Errorf("Total = %d, want 3", result.Total)
	}
	if len(result.Items) != 2 {
		t.Errorf("Items 数量 = %d, want 2", len(result.Items))
	}

	// 测试第二页
	result, err = GetPlayersPage(ctx, "", 2, 2)
	if err != nil {
		t.Fatalf("GetPlayersPage 第2页失败: %v", err)
	}
	if len(result.Items) != 1 {
		t.Errorf("第2页 Items 数量 = %d, want 1", len(result.Items))
	}

	// 测试关键字搜索（按 player_id）
	result, err = GetPlayersPage(ctx, testPlayerID1, 1, 20)
	if err != nil {
		t.Fatalf("GetPlayersPage 搜索ID失败: %v", err)
	}
	if result.Total != 1 {
		t.Errorf("搜索ID Total = %d, want 1", result.Total)
	}

	// 测试关键字搜索（按 remark）
	result, err = GetPlayersPage(ctx, "管理员", 1, 20)
	if err != nil {
		t.Fatalf("GetPlayersPage 搜索备注失败: %v", err)
	}
	if result.Total != 1 {
		t.Errorf("搜索备注 Total = %d, want 1", result.Total)
	}
	if len(result.Items) != 1 || result.Items[0].PlayerID != testPlayerID1 {
		t.Errorf("搜索备注结果不正确")
	}

	// 测试无匹配结果
	result, err = GetPlayersPage(ctx, "不存在的关键字", 1, 20)
	if err != nil {
		t.Fatalf("GetPlayersPage 无匹配失败: %v", err)
	}
	if result.Total != 0 {
		t.Errorf("无匹配 Total = %d, want 0", result.Total)
	}
	if len(result.Items) != 0 {
		t.Errorf("无匹配 Items 数量 = %d, want 0", len(result.Items))
	}
}
