variable "bedrock_model_id" {
  description = "Bedrock model or inference-profile ID used by the Converse API."
  type        = string
  default     = "us.amazon.nova-lite-v1:0"
}

variable "resurrections_enabled" {
  description = "Kill switch. When false the API answers 503 resurrections_disabled."
  type        = bool
  default     = true
}

variable "lifetime_minutes" {
  description = "How long a resurrection stays alive before the reaper removes it."
  type        = number
  default     = 20
}
