// TEMPORARY: Manual Database type. Replace with generated types by running:
//   npx supabase gen types typescript --linked > src/lib/database.types.ts
// This manual type is a bridge until the Supabase project is linked.
// The file structure supports drop-in replacement with generated types.

export interface Database {
  public: {
    PostgrestVersion: '12';
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
        Relationships: [
          {
            foreignKeyName: 'categories_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: 'sources_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
        ];
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
          qa_rewritten: boolean;
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
          qa_rewritten?: boolean;
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
          qa_rewritten?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'questions_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'questions_source_id_fkey';
            columns: ['source_id'];
            isOneToOne: false;
            referencedRelation: 'sources';
            referencedColumns: ['id'];
          },
        ];
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
          questions_qa_passed: number;
          questions_qa_rewritten: number;
          questions_qa_rejected: number;
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
          questions_qa_passed?: number;
          questions_qa_rewritten?: number;
          questions_qa_rejected?: number;
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
          questions_qa_passed?: number;
          questions_qa_rewritten?: number;
          questions_qa_rejected?: number;
          total_input_tokens?: number;
          total_output_tokens?: number;
          estimated_cost_usd?: number;
          config?: Record<string, unknown> | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
