use seki_api_types::ws::LiveGameItem;

#[test]
fn deserialize_with_ranked_present() {
    let json = r#"{"id":1,"creator_id":1,"stage":"unstarted","black":null,"white":null,"settings":{"cols":19,"rows":19,"handicap":0,"max_rating_difference_lower":null,"max_rating_difference_higher":null,"rating_difference_lower_unlimited":true,"rating_difference_higher_unlimited":true,"rating_range_mode":"absolute","time_control":"fischer","main_time_secs":null,"increment_secs":null,"byoyomi_time_secs":null,"byoyomi_periods":null,"is_private":false,"invite_only":false,"ranked":false,"rating_status":"unranked","color_reason":null,"calibration_policy_version":null},"move_count":null,"ranked":false,"derived_handicap":null,"derived_komi":null,"derived_color_reason":null}"#;
    let item: LiveGameItem = serde_json::from_str(json).unwrap();
    assert!(!item.ranked);
}

#[test]
fn deserialize_without_ranked_field() {
    let json = r#"{"id":1,"creator_id":1,"stage":"unstarted","black":null,"white":null,"settings":{"cols":19,"rows":19,"handicap":0,"max_rating_difference_lower":null,"max_rating_difference_higher":null,"rating_difference_lower_unlimited":true,"rating_difference_higher_unlimited":true,"rating_range_mode":"absolute","time_control":"fischer","main_time_secs":null,"increment_secs":null,"byoyomi_time_secs":null,"byoyomi_periods":null,"is_private":false,"invite_only":false,"ranked":false,"rating_status":"unranked","color_reason":null,"calibration_policy_version":null},"move_count":null,"derived_handicap":null,"derived_komi":null,"derived_color_reason":null}"#;
    let item: LiveGameItem = serde_json::from_str(json).unwrap();
    assert!(!item.ranked);
}
