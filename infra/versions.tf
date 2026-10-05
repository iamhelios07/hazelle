terraform {
  required_version = ">= 1.9"
  required_providers {
    vultr = {
      source  = "vultr/vultr"
      version = "2.32.0"
    }
  }
}

# The API key comes from the VULTR_API_KEY environment variable of the shell running terraform, never from a file.
provider "vultr" {}
