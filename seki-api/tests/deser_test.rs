use seki_api::game::{ClockSnapshot, GameSettings, InGameClock, TimeControl};
use seki_api::ws::{LiveGameItem, ServerMsg};

// ---------------------------------------------------------------------------
// LiveGameItem — backward-compat: `ranked` field may be absent
// ---------------------------------------------------------------------------

#[test]
fn deserialize_live_item_with_ranked_present() {
    let json = r#"{"id":1,"creator_id":1,"stage":"unstarted","black":null,"white":null,"settings":{"cols":19,"rows":19,"handicap":0,"max_rating_difference_lower":null,"max_rating_difference_higher":null,"rating_difference_lower_unlimited":true,"rating_difference_higher_unlimited":true,"rating_range_mode":"absolute","time_control":"fischer","main_time_secs":null,"increment_secs":null,"byoyomi_time_secs":null,"byoyomi_periods":null,"is_private":false,"invite_only":false,"ranked":false,"rating_status":"unranked","color_reason":null,"calibration_policy_version":null},"move_count":null,"ranked":false,"derived_handicap":null,"derived_komi":null,"derived_color_reason":null}"#;
    let item: LiveGameItem = serde_json::from_str(json).unwrap();
    assert!(!item.ranked);
}

#[test]
fn deserialize_live_item_without_ranked_field() {
    let json = r#"{"id":1,"creator_id":1,"stage":"unstarted","black":null,"white":null,"settings":{"cols":19,"rows":19,"handicap":0,"max_rating_difference_lower":null,"max_rating_difference_higher":null,"rating_difference_lower_unlimited":true,"rating_difference_higher_unlimited":true,"rating_range_mode":"absolute","time_control":"fischer","main_time_secs":null,"increment_secs":null,"byoyomi_time_secs":null,"byoyomi_periods":null,"is_private":false,"invite_only":false,"ranked":false,"rating_status":"unranked","color_reason":null,"calibration_policy_version":null},"move_count":null,"derived_handicap":null,"derived_komi":null,"derived_color_reason":null}"#;
    let item: LiveGameItem = serde_json::from_str(json).unwrap();
    assert!(!item.ranked);
}

// ---------------------------------------------------------------------------
// GameSettings — time_control enum
// ---------------------------------------------------------------------------

#[test]
fn time_control_serialization_round_trip() {
    let settings = GameSettings {
        cols: 19,
        rows: 19,
        handicap: 0,
        max_rating_difference_lower: None,
        max_rating_difference_higher: None,
        rating_difference_lower_unlimited: true,
        rating_difference_higher_unlimited: true,
        rating_range_mode: "absolute".into(),
        time_control: TimeControl::Fischer,
        main_time_secs: Some(600),
        increment_secs: Some(5),
        byoyomi_time_secs: None,
        byoyomi_periods: None,
        is_private: false,
        invite_only: false,
        ranked: false,
        rating_status: "unranked".into(),
        color_reason: None,
        calibration_policy_version: None,
    };

    let json = serde_json::to_string(&settings).unwrap();
    assert!(json.contains(r#""time_control":"fischer""#));

    let round_tripped: GameSettings = serde_json::from_str(&json).unwrap();
    assert_eq!(round_tripped.time_control, TimeControl::Fischer);
}

#[test]
fn time_control_variants() {
    for (variant, expected_str) in [
        (TimeControl::None, "none"),
        (TimeControl::Fischer, "fischer"),
        (TimeControl::Byoyomi, "byoyomi"),
        (TimeControl::Correspondence, "correspondence"),
    ] {
        let s = serde_json::to_string(&variant).unwrap();
        assert_eq!(s, format!("\"{expected_str}\""));
        let back: TimeControl = serde_json::from_str(&s).unwrap();
        assert_eq!(back, variant);
    }
}

// ---------------------------------------------------------------------------
// InGameClock
// ---------------------------------------------------------------------------

#[test]
fn in_game_clock_deserialization() {
    let json = r#"{
        "type": "fischer",
        "black": { "remaining_ms": 580000, "periods": 0 },
        "white": { "remaining_ms": 600000, "periods": 0 },
        "active_stone": 1,
        "server_now_ms": 1700000000000
    }"#;

    let clock: InGameClock = serde_json::from_str(json).unwrap();
    assert_eq!(clock.clock_type, "fischer");
    assert_eq!(clock.black.remaining_ms, 580000);
    assert_eq!(clock.white.remaining_ms, 600000);
    assert_eq!(clock.active_stone, Some(1));
    assert_eq!(clock.server_now_ms, 1700000000000);
}

// ---------------------------------------------------------------------------
// ClockSnapshot
// ---------------------------------------------------------------------------

#[test]
fn clock_snapshot_round_trip() {
    let snap = ClockSnapshot {
        black_ms: Some(300000),
        white_ms: Some(290000),
        black_periods: Some(3),
        white_periods: Some(3),
        active_stone: Some(1),
    };
    let json = serde_json::to_string(&snap).unwrap();
    let back: ClockSnapshot = serde_json::from_str(&json).unwrap();
    assert_eq!(back.black_ms, Some(300000));
    assert_eq!(back.white_ms, Some(290000));
    assert_eq!(back.active_stone, Some(1));
}

// ---------------------------------------------------------------------------
// ServerMsg — kind-based discrimination
// ---------------------------------------------------------------------------

#[test]
fn deserialize_server_msg_error() {
    let json = r#"{"kind":"error","game_id":null,"message":"something went wrong","client_message_id":null}"#;
    let msg: ServerMsg = serde_json::from_str(json).unwrap();
    match msg {
        ServerMsg::Error { message, .. } => {
            assert_eq!(message, "something went wrong");
        }
        _ => panic!("expected Error variant"),
    }
}

#[test]
fn deserialize_server_msg_game_removed() {
    let json = r#"{"kind":"game_removed","game_id":42}"#;
    let msg: ServerMsg = serde_json::from_str(json).unwrap();
    match msg {
        ServerMsg::GameRemoved { game_id } => assert_eq!(game_id, 42),
        _ => panic!("expected GameRemoved variant"),
    }
}

#[test]
fn deserialize_server_msg_player_disconnected() {
    let json = r#"{"kind":"player_disconnected","game_id":1,"user_id":7,"timestamp":"2025-01-01T00:00:00Z","grace_period_ms":120000}"#;
    let msg: ServerMsg = serde_json::from_str(json).unwrap();
    match msg {
        ServerMsg::PlayerDisconnected {
            game_id,
            user_id,
            grace_period_ms,
            ..
        } => {
            assert_eq!(game_id, 1);
            assert_eq!(user_id, 7);
            assert_eq!(grace_period_ms, Some(120000));
        }
        _ => panic!("expected PlayerDisconnected variant"),
    }
}

#[test]
fn deserialize_server_msg_presentation_started() {
    let json = r#"{"kind":"presentation_started","game_id":5,"presenter_id":10,"originator_id":10,"snapshot":"","control_request":null}"#;
    let msg: ServerMsg = serde_json::from_str(json).unwrap();
    match msg {
        ServerMsg::PresentationStarted { presenter_id, .. } => {
            assert_eq!(presenter_id, 10);
        }
        _ => panic!("expected PresentationStarted variant"),
    }
}

#[test]
fn deserialize_server_msg_control_changed() {
    let json = r#"{"kind":"control_changed","game_id":5,"presenter_id":11}"#;
    let msg: ServerMsg = serde_json::from_str(json).unwrap();
    match msg {
        ServerMsg::ControlChanged { presenter_id, .. } => {
            assert_eq!(presenter_id, 11);
        }
        _ => panic!("expected ControlChanged variant"),
    }
}

#[test]
fn deserialize_server_msg_control_requested() {
    let json = r#"{"kind":"control_requested","game_id":5,"user_id":12,"display_name":"Alice"}"#;
    let msg: ServerMsg = serde_json::from_str(json).unwrap();
    match msg {
        ServerMsg::ControlRequested {
            user_id,
            display_name,
            ..
        } => {
            assert_eq!(user_id, 12);
            assert_eq!(display_name, "Alice");
        }
        _ => panic!("expected ControlRequested variant"),
    }
}

#[test]
fn deserialize_server_msg_control_request_cancelled() {
    let json = r#"{"kind":"control_request_cancelled","game_id":5}"#;
    let msg: ServerMsg = serde_json::from_str(json).unwrap();
    match msg {
        ServerMsg::ControlRequestCancelled { .. } => {}
        _ => panic!("expected ControlRequestCancelled variant"),
    }
}

// ServerMsg must be round-trippable (Serialize + Deserialize).
#[test]
fn server_msg_presence_changed_round_trip() {
    let msg = ServerMsg::PresenceChanged {
        user_id: 1,
        online: true,
    };
    let json = serde_json::to_string(&msg).unwrap();
    let back: ServerMsg = serde_json::from_str(&json).unwrap();
    match back {
        ServerMsg::PresenceChanged { user_id, online } => {
            assert_eq!(user_id, 1);
            assert!(online);
        }
        _ => panic!("expected PresenceChanged"),
    }
}

#[test]
fn server_msg_game_removed_round_trip() {
    let msg = ServerMsg::GameRemoved { game_id: 99 };
    let json = serde_json::to_string(&msg).unwrap();
    assert_eq!(json, r#"{"kind":"game_removed","game_id":99}"#);
    let back: ServerMsg = serde_json::from_str(&json).unwrap();
    match back {
        ServerMsg::GameRemoved { game_id } => assert_eq!(game_id, 99),
        _ => panic!("expected GameRemoved"),
    }
}
