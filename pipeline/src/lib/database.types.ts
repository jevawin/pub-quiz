export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string
          created_by: string
          depth: number
          description: string | null
          id: string
          name: string
          parent_id: string | null
          slug: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          depth?: number
          description?: string | null
          id?: string
          name: string
          parent_id?: string | null
          slug: string
        }
        Update: {
          created_at?: string
          created_by?: string
          depth?: number
          description?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_runs: {
        Row: {
          categories_failed: number | null
          categories_processed: number | null
          completed_at: string | null
          config: Json | null
          error_message: string | null
          estimated_cost_usd: number | null
          id: string
          questions_calibrated: number | null
          questions_enriched: number | null
          questions_failed: number | null
          questions_generated: number | null
          questions_qa_passed: number | null
          questions_qa_rejected: number | null
          questions_qa_rewritten: number | null
          questions_recalibrated: number | null
          questions_rejected: number | null
          questions_verified: number | null
          sources_failed: number | null
          sources_fetched: number | null
          started_at: string
          status: string
          total_input_tokens: number | null
          total_output_tokens: number | null
        }
        Insert: {
          categories_failed?: number | null
          categories_processed?: number | null
          completed_at?: string | null
          config?: Json | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          id?: string
          questions_calibrated?: number | null
          questions_enriched?: number | null
          questions_failed?: number | null
          questions_generated?: number | null
          questions_qa_passed?: number | null
          questions_qa_rejected?: number | null
          questions_qa_rewritten?: number | null
          questions_recalibrated?: number | null
          questions_rejected?: number | null
          questions_verified?: number | null
          sources_failed?: number | null
          sources_fetched?: number | null
          started_at?: string
          status?: string
          total_input_tokens?: number | null
          total_output_tokens?: number | null
        }
        Update: {
          categories_failed?: number | null
          categories_processed?: number | null
          completed_at?: string | null
          config?: Json | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          id?: string
          questions_calibrated?: number | null
          questions_enriched?: number | null
          questions_failed?: number | null
          questions_generated?: number | null
          questions_qa_passed?: number | null
          questions_qa_rejected?: number | null
          questions_qa_rewritten?: number | null
          questions_recalibrated?: number | null
          questions_rejected?: number | null
          questions_verified?: number | null
          sources_failed?: number | null
          sources_fetched?: number | null
          started_at?: string
          status?: string
          total_input_tokens?: number | null
          total_output_tokens?: number | null
        }
        Relationships: []
      }
      questions: {
        Row: {
          calibrated_at: string | null
          calibration_percent: number | null
          category_id: string
          correct_answer: string
          created_at: string
          difficulty: string
          distractors: Json
          explanation: string | null
          fun_fact: string | null
          id: string
          published_at: string | null
          qa_rewritten: boolean | null
          question_text: string
          source_id: string | null
          status: string
          verification_score: number
        }
        Insert: {
          calibrated_at?: string | null
          calibration_percent?: number | null
          category_id: string
          correct_answer: string
          created_at?: string
          difficulty: string
          distractors?: Json
          explanation?: string | null
          fun_fact?: string | null
          id?: string
          published_at?: string | null
          qa_rewritten?: boolean | null
          question_text: string
          source_id?: string | null
          status?: string
          verification_score?: number
        }
        Update: {
          calibrated_at?: string | null
          calibration_percent?: number | null
          category_id?: string
          correct_answer?: string
          created_at?: string
          difficulty?: string
          distractors?: Json
          explanation?: string | null
          fun_fact?: string | null
          id?: string
          published_at?: string | null
          qa_rewritten?: boolean | null
          question_text?: string
          source_id?: string | null
          status?: string
          verification_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "questions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          category_id: string
          content: string
          content_hash: string
          fetched_at: string
          id: string
          title: string
          url: string
        }
        Insert: {
          category_id: string
          content: string
          content_hash: string
          fetched_at?: string
          id?: string
          title: string
          url: string
        }
        Update: {
          category_id?: string
          content?: string
          content_hash?: string
          fetched_at?: string
          id?: string
          title?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "sources_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
