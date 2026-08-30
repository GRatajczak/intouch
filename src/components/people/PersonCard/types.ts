import type { Tables } from "@/db/database.types";

export interface PersonCardProps {
  person: Tables<"people">;
}
