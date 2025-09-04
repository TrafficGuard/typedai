# Example Terraform with Identity-Aware Proxy and Cloud Armour

# This datasource and locals are used to fetch and filter Atlassian IP ranges for Jira egress traffic to allow traffic to our webhooks.
data "http" "atlassian_ip_ranges" {
  url = "https://ip-ranges.atlassian.com"
  retry {
    attempts     = 3
    min_delay_ms = 1000
    max_delay_ms = 10000
  }
}

locals {
  max_ips_per_rule = 10

  atlassian_data          = jsondecode(data.http.atlassian_ip_ranges.response_body)
  atlassian_base_priority = 1011

  # Filter the list to include only items that are for 'jira' and 'egress'
  atlassian_filtered_ips = [
    for item in local.atlassian_data.items : item.cidr
    if contains(try(item.product, []), "jira") && contains(try(item.direction, []), "egress")
  ]

  # Chunk the filtered list of IPs into smaller lists, each with a max size of `local.max_ips_per_rule`.
  atlassian_ip_chunks = [
    for i in range(0, length(local.atlassian_filtered_ips), local.max_ips_per_rule) :
    slice(local.atlassian_filtered_ips, i, min(i + local.max_ips_per_rule, length(local.atlassian_filtered_ips)))
  ]
}


data "google_secret_manager_secret_version" "iap_oauth_secret" {
  secret = "iap_oauth_secret"
}

module "lb-http" {
  source  = "custom.example.com/modules/google//modules/lb-http"
  version = "~> 4.0.1"

  project = var.project_id
  name    = "core-${var.env}-lb"

  create_address      = true
  create_ipv6_address = true
  create_url_map      = false
  enable_ipv6         = true
  https_redirect      = true
  ssl_policy          = module.networks.standard_ssl_policy.self_link
  url_map             = google_compute_url_map.default.id
  dns_auth_domains    = []
  dns_project         = var.project_id
  dns_domains         = ["ai.example.com"]
  firewall_networks   = ["typedai-vpc"]
  managed_ssl_certificate_domains = {
    "ai"         = ["ai.example.com"]
  }

  backends = {
    typedai = {
      description = "TypedAI (IAP)"
      port        = 8080
      port_name   = "web-api"
      timeout_sec = 3600 # 1hr
      health_check = {
        request_path = "/health-check"
        port         = 8080
      }
      log_config = {
        enable      = true
        sample_rate = 1.0
      }
      iap_config = {
        enable               = var.oauth_clientid != "" ? true : false
        oauth2_client_id     = var.oauth_clientid
        oauth2_client_secret = data.google_secret_manager_secret_version.iap_oauth_secret.secret_data
        web_users            = ["domain:adveritas.com.au"]
      }
      groups = [
        {
          group                 = module.typedai.instance_group.id
          balancing_mode        = "UTILIZATION"
          max_rate_per_instance = 100
        },
      ]
    }
    // Second mapping with security policy instead of IAP to allow webhook calls
    typedai-armour = {
      description = "TypedAI (Armour)"
      port        = 8080
      port_name   = "web-api"
      timeout_sec = 3600 # 1hr
      health_check = {
        request_path = "/health-check"
        port         = 8080
      }

      security_policy = google_compute_security_policy.typedai_armour.self_link

      log_config = {
        enable      = true
        sample_rate = 1.0
      }

      groups = [
        {
          group                 = module.typedai.instance_group.id
          balancing_mode        = "UTILIZATION"
          max_rate_per_instance = 100
        },
      ]
    }
  }
}



resource "google_compute_url_map" "default" {
  name = "lb-https"

  host_rule {
    hosts        = ["ai.example.com"]
    path_matcher = "ai"
  }
  path_matcher {
    name = "ai"
    # Default to the UI bucket
    default_service = google_compute_backend_bucket.typedai-ui-backened.self_link

    # Webhooks routes require ip addresses whitelist in a CLoud Armour policy
    route_rules {
      match_rules {
        path_template_match = "/api/webhooks/**"
      }
      service  = module.lb-http.backend_services["typedai-armour"].self_link
      priority = 1
    }
    # All other API routes to the IAP protected backend
    route_rules {
      match_rules {
        path_template_match = "/api/**"
      }
      service  = module.lb-http.backend_services["typedai"].self_link
      priority = 2
    }
    route_rules {
      match_rules {
        path_template_match = "/"
      }
      service  = module.lb-http.backend_services["typedai"].self_link
      priority = 3
    }
    route_rules {
      match_rules {
        path_template_match = "/ui/**"
      }
      service  = module.lb-http.backend_services["typedai"].self_link
      priority = 4
    }
  }
}

resource "google_compute_backend_bucket" "typedai-ui-backened" {
  name        = "typedai-ui-backend"
  bucket_name = module.ai_ui_bucket.name
  enable_cdn  = false
}


resource "google_compute_security_policy" "typedai_armour" {
  name = "typedai_armour"

  # GitHub webhooks
  rule {
    action   = "allow"
    priority = "1010"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = [
          "192.30.252.0/22",
          "185.199.108.0/22",
          "140.82.112.0/20",
          "143.55.64.0/20",
          "2a0a:a440::/29",
          "2606:50c0::/32",
        ]
      }
    }
    description = "GitHub Webhook IPs from https://api.github.com/meta" # TODO make dynamic like Jira IPs
  }

  # Dynamic Atlassian Rules - iterates over the "chunks" we created in `locals` and generates a rule for each one.
  dynamic "rule" {
    for_each = local.atlassian_ip_chunks

    content {
      action      = "allow"
      description = "Atlassian Jira Egress IPs (${rule.key + 1} of ${length(local.atlassian_ip_chunks)})"
      # The priority is calculated dynamically to ensure each rule is unique and sequential after the base priority.
      priority = local.atlassian_base_priority + rule.key
      match {
        versioned_expr = "SRC_IPS_V1"
        config {
          src_ip_ranges = rule.value
        }
      }
    }
  }


  # See default rule https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_security_policy#rule
  rule {
    action   = "deny(403)"
    priority = "2147483647"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "default rule - deny all"
  }
}