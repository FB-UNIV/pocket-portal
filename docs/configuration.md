# Settings

Every setting can come from an environment variable, or from the optional
YAML file named by `CONFIG_FILE` (see the [runbook](./deploy)). Secrets also
accept a `NAME_FILE` variant pointing at a Docker or Kubernetes secret.

The table below is the README's own, included as is, so there is one list
to keep up to date (a unit test checks it covers every setting).

<!--@include: ../README.md#settings-->
