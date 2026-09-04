import type { Tables } from "@/db/database.types";

export interface PersonEditFormProps {
  person: Tables<"people">;
  onSaved: (person: Tables<"people">) => void;
  onCancel: () => void;
}

export interface PersonEditFormState {
  name: string;
  relationshipType: string;
  description: string;
  isCollective: string;
  weight: number;
  relationshipContext: string;
  contextTags: string[];
  lastContactBucket: string;
}
