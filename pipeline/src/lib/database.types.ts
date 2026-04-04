// TEMPORARY: Manual Database type. Replace with generated types by running:
//   npx supabase gen types typescript --linked > src/lib/database.types.ts
// This manual type is a bridge until the Supabase project is linked.
// The file structure supports drop-in replacement with generated types.

export interface Database {
  public: {
    Tables: {
      categories: {
        Row: {
          id: string;
          name: string;
          slug: string;
          parent_id: string | null;
          depth: number;
          description: string | null;
          created_at: string;
          created_by: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          parent_id?: string | null;
          depth?: number;
          description?: string | null;
          created_at?: string;
          created_by?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          parent_id?: string | null;
          depth?: number;
          description?: string | null;
          created_at?: string;
          created_by?: string;
        };
      };
      sources: {
        Row: {
          id: string;
          category_id: string;
          title: string;
          url: string;
          content: string;
          content_hash: string;
          fetched_at: string;
        };
        Insert: {
          id?: string;
          category_id: string;
          title: string;
          url: string;
          content: string;
          content_hash: string;
          fetched_at?: string;
        };
        Update: {
          id?: string;
          category_id?: string;
          title?: string;
          url?: string;
          content?: string;
          content_hash?: string;
          fetched_at?: string;
        };
      };
      questions: {
        Row: {
          id: string;
          category_id: string;
          source_id: string | null;
          question_text: string;
          correct_answer: string;
          distractors: string[];
          explanation: string | null;
          difficulty: 'easy' | 'normal' | 'hard';
          verification_score: number;
          status: 'pending' | 'verified' | 'rejected' | 'published';
          created_at: string;
          published_at: string | null;
        };
        Insert: {
          id?: string;
          category_id: string;
          source_id?: string | null;
          question_text: string;
          correct_answer: string;
          distractors: string[];
          explanation?: string | null;
          difficulty: 'easy' | 'normal' | 'hard';
          verification_score?: number;
          status?: 'pending' | 'verified' | 'rejected' | 'published';
          created_at?: string;
          published_at?: string | null;
        };
        Update: {
          id?: string;
          category_id?: string;
          source_id?: string | null;
          question_text?: string;
          correct_answer?: string;
          distractors?: string[];
          explanation?: string | null;
          difficulty?: 'easy' | 'normal' | 'hard';
          verification_score?: number;
          status?: 'pending' | 'verified' | 'rejected' | 'published';
          created_at?: string;
          published_at?: string | null;
        };
      };
      pipeline_runs: {
        Row: {
          id: string;
          started_at: string;
          completed_at: string | null;
          status: 'running' | 'success' | 'failed';
          error_message: string | null;
          categories_processed: number;
          categories_failed: number;
          sources_fetched: number;
          sources_failed: number;
          questions_generated: number;
          questions_failed: number;
          questions_verified: number;
          questions_rejected: number;
          total_input_tokens: number;
          total_output_tokens: number;
          estimated_cost_usd: number;
          config: Record<string, unknown> | null;
        };
        Insert: {
          id?: string;
          started_at?: string;
          completed_at?: string | null;
          status?: 'running' | 'success' | 'failed';
          error_message?: string | null;
          categories_processed?: number;
          categories_failed?: number;
          sources_fetched?: number;
          sources_failed?: number;
          questions_generated?: number;
          questions_failed?: number;
          questions_verified?: number;
          questions_rejected?: number;
          total_input_tokens?: number;
          total_output_tokens?: number;
          estimated_cost_usd?: number;
          config?: Record<string, unknown> | null;
        };
        Update: {
          id?: string;
          started_at?: string;
          completed_at?: string | null;
          status?: 'running' | 'success' | 'failed';
          error_message?: string | null;
          categories_processed?: number;
          categories_failed?: number;
          sources_fetched?: number;
          sources_failed?: number;
          questions_generated?: number;
          questions_failed?: number;
          questions_verified?: number;
          questions_rejected?: number;
          total_input_tokens?: number;
          total_output_tokens?: number;
          estimated_cost_usd?: number;
          config?: Record<string, unknown> | null;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
