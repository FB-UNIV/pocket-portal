import { readOtelServiceName } from "@/lib/config";

export function resolveServiceName(): string {
  return readOtelServiceName();
}
