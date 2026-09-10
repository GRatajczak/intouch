export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      contact_events: {
        Row: {
          created_at: string
          id: string
          note: string | null
          occurred_at: string
          outcome: string
          owner_id: string
          person_id: string
          ranking_entry_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          occurred_at?: string
          outcome: string
          owner_id: string
          person_id: string
          ranking_entry_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          occurred_at?: string
          outcome?: string
          owner_id?: string
          person_id?: string
          ranking_entry_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_events_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_events_ranking_entry_id_fkey"
            columns: ["ranking_entry_id"]
            isOneToOne: false
            referencedRelation: "ranking_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          context_tags: string[]
          created_at: string
          description: string
          id: string
          is_collective: boolean
          last_contact_bucket: string | null
          name: string
          owner_id: string
          relationship_context: string | null
          relationship_type: string
          status: string
          weight: number
        }
        Insert: {
          context_tags?: string[]
          created_at?: string
          description: string
          id?: string
          is_collective?: boolean
          last_contact_bucket?: string | null
          name: string
          owner_id: string
          relationship_context?: string | null
          relationship_type: string
          status?: string
          weight: number
        }
        Update: {
          context_tags?: string[]
          created_at?: string
          description?: string
          id?: string
          is_collective?: boolean
          last_contact_bucket?: string | null
          name?: string
          owner_id?: string
          relationship_context?: string | null
          relationship_type?: string
          status?: string
          weight?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          analytics_opt_out: boolean
          availability_windows: string[]
          birth_date: string
          free_recompute_claimed_on: string | null
          life_context: string
          name: string
          openai_api_key_ciphertext: string | null
          openai_api_key_hint: string | null
          owner_id: string
          preferred_channels: string[]
          reminders_enabled: boolean
          updated_at: string
          weekly_time_budget: string | null
        }
        Insert: {
          analytics_opt_out?: boolean
          availability_windows?: string[]
          birth_date: string
          free_recompute_claimed_on?: string | null
          life_context: string
          name: string
          openai_api_key_ciphertext?: string | null
          openai_api_key_hint?: string | null
          owner_id: string
          preferred_channels?: string[]
          reminders_enabled?: boolean
          updated_at?: string
          weekly_time_budget?: string | null
        }
        Update: {
          analytics_opt_out?: boolean
          availability_windows?: string[]
          birth_date?: string
          free_recompute_claimed_on?: string | null
          life_context?: string
          name?: string
          openai_api_key_ciphertext?: string | null
          openai_api_key_hint?: string | null
          owner_id?: string
          preferred_channels?: string[]
          reminders_enabled?: boolean
          updated_at?: string
          weekly_time_budget?: string | null
        }
        Relationships: []
      }
      ranking_entries: {
        Row: {
          context_note: string | null
          id: string
          owner_id: string
          person_id: string
          rank_position: number
          ranking_id: string
          reason: string
          rhythm_note: string | null
          time_window: string
        }
        Insert: {
          context_note?: string | null
          id?: string
          owner_id: string
          person_id: string
          rank_position: number
          ranking_id: string
          reason: string
          rhythm_note?: string | null
          time_window: string
        }
        Update: {
          context_note?: string | null
          id?: string
          owner_id?: string
          person_id?: string
          rank_position?: number
          ranking_id?: string
          reason?: string
          rhythm_note?: string | null
          time_window?: string
        }
        Relationships: [
          {
            foreignKeyName: "ranking_entries_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ranking_entries_ranking_id_fkey"
            columns: ["ranking_id"]
            isOneToOne: false
            referencedRelation: "rankings"
            referencedColumns: ["id"]
          },
        ]
      }
      rankings: {
        Row: {
          created_at: string
          id: string
          model: string
          owner_id: string
          people_considered: number
          people_total: number
        }
        Insert: {
          created_at?: string
          id?: string
          model: string
          owner_id: string
          people_considered: number
          people_total: number
        }
        Update: {
          created_at?: string
          id?: string
          model?: string
          owner_id?: string
          people_considered?: number
          people_total?: number
        }
        Relationships: []
      }
      reminder_sends: {
        Row: {
          error: string | null
          id: string
          owner_id: string
          person_id: string | null
          provider_message_id: string | null
          ranking_id: string | null
          sent_at: string
          status: string
        }
        Insert: {
          error?: string | null
          id?: string
          owner_id: string
          person_id?: string | null
          provider_message_id?: string | null
          ranking_id?: string | null
          sent_at?: string
          status: string
        }
        Update: {
          error?: string | null
          id?: string
          owner_id?: string
          person_id?: string | null
          provider_message_id?: string | null
          ranking_id?: string | null
          sent_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_sends_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_sends_ranking_id_fkey"
            columns: ["ranking_id"]
            isOneToOne: false
            referencedRelation: "rankings"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      record_reminder_send: {
        Args: {
          p_error: string
          p_owner_id: string
          p_person_id: string
          p_provider_message_id: string
          p_ranking_id: string
          p_status: string
        }
        Returns: string
      }
      reminder_candidates: {
        Args: { cooldown_days: number; max_rows: number }
        Returns: {
          email: string
          last_sent_at: string
          owner_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

