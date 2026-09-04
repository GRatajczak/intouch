export interface PersonFormProps {
  serverError?: string | null;
}

export interface PersonRowState {
  id: number;
  name: string;
  relationshipType: string;
  description: string;
  isCollective: string;
  weight: number;
  relationshipContext: string;
  contextTags: string[];
  lastContactBucket: string;
}
