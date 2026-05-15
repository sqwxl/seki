use seki_web::routes::api::ApiDoc;
use utoipa::OpenApi;

fn main() {
    let spec = ApiDoc::openapi()
        .to_pretty_json()
        .expect("failed to generate OpenAPI spec");
    println!("{spec}");
}
