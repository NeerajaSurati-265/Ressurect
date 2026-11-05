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

variable "backends_enabled" {
  description = "Feature flag for backend apps (FastAPI, Flask, Django, Express). Keep \"false\" unless the Lambda concurrency quota is above 100."
  type        = string
  default     = "false"
}

variable "fullstack_enabled" {
  description = "B5: React frontend + backend from one repo raised as one resurrection. Only has effect when backends_enabled is \"true\"."
  type        = string
  default     = "false"
}

variable "max_live_backends" {
  description = "How many rz-* backend functions may be alive at once."
  type        = number
  default     = 2
}
