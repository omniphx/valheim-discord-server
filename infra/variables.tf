variable "region" {
  type    = string
  default = "us-east-2"
}
variable "name" {
  type    = string
  default = "valheim"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,24}$", var.name))
    error_message = "Use 3–25 lowercase letters, numbers or hyphens, starting with a letter."
  }
}
variable "discord_application_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]+$", var.discord_application_id))
    error_message = "Provide the Discord application ID."
  }
}
variable "discord_public_key" {
  type = string
  validation {
    condition     = can(regex("^[a-fA-F0-9]{64}$", var.discord_public_key))
    error_message = "Provide the 64-character Discord public key."
  }
}
variable "discord_guild_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]+$", var.discord_guild_id))
    error_message = "Provide your Discord server ID."
  }
}
variable "allowed_role_ids" {
  type = set(string)
  validation {
    condition     = length(var.allowed_role_ids) > 0 && alltrue([for id in var.allowed_role_ids : can(regex("^[0-9]+$", id))])
    error_message = "Provide at least one Discord role ID. Members need this role even if they are administrators."
  }
}
variable "password_parameter_name" {
  type        = string
  default     = "/valheim/server-password"
  description = "Existing SSM SecureString parameter. Its value is never read by Terraform."
  validation {
    condition     = can(regex("^/[a-zA-Z0-9_./-]+$", var.password_parameter_name))
    error_message = "Use an absolute SSM parameter path."
  }
}
variable "server_name" {
  type    = string
  default = "Friends of Valheim"
  validation {
    condition     = can(regex("^[a-zA-Z0-9 _-]{1,60}$", var.server_name))
    error_message = "Use 1–60 letters, numbers, spaces, underscores or hyphens."
  }
}
variable "world_name" {
  type    = string
  default = "Midgard"
  validation {
    condition     = can(regex("^[a-zA-Z0-9_-]{1,60}$", var.world_name))
    error_message = "Use 1–60 letters, numbers, underscores or hyphens."
  }
}
variable "instance_type" {
  type    = string
  default = "t3a.large"
  validation {
    condition     = contains(["t3a.medium", "t3a.large", "t3a.xlarge", "t3.medium", "t3.large", "t3.xlarge"], var.instance_type)
    error_message = "Choose a supported x86 T3/T3a instance; ARM instances cannot run this image natively."
  }
}
variable "world_disk_gb" {
  type    = number
  default = 30
  validation {
    condition     = var.world_disk_gb >= 20 && floor(var.world_disk_gb) == var.world_disk_gb
    error_message = "Choose an integer size of at least 20 GiB."
  }
}
variable "allowed_game_cidrs" {
  type    = set(string)
  default = ["0.0.0.0/0"]
  validation {
    condition     = length(var.allowed_game_cidrs) > 0 && alltrue([for cidr in var.allowed_game_cidrs : can(cidrnetmask(cidr))])
    error_message = "Provide valid IPv4 CIDRs."
  }
}
variable "crossplay" {
  type    = bool
  default = false
}
variable "container_image" {
  type    = string
  default = "ghcr.io/community-valheim-tools/valheim-server:latest"
  validation {
    condition     = can(regex("^[a-zA-Z0-9/_.:@-]+$", var.container_image))
    error_message = "Provide a container image reference, preferably pinned to a digest."
  }
}

variable "allow_portal_items" {
  type        = bool
  default     = false
  description = "Apply the casual portal modifier so ore and other restricted items can pass through portals."
}

variable "double_resources" {
  type        = bool
  default     = false
  description = "Apply the muchmore resource modifier (2x drops) to the selected world."
}
