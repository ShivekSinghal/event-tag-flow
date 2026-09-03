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
      bookings: {
        Row: {
          amount: number
          amount_inr: number
          booking_date: string | null
          booking_source: string
          created_at: string | null
          id: string
          package_category: string
          package_key: string | null
          package_name: string | null
          pax: number | null
          payment_id: string | null
          payment_reference: string | null
          payment_status: string | null
          quantity: number
          studio_location: string
          updated_at: string | null
          user_email: string | null
          user_name: string
          user_phone: string
        }
        Insert: {
          amount: number
          amount_inr: number
          booking_date?: string | null
          booking_source?: string
          created_at?: string | null
          id?: string
          package_category: string
          package_key?: string | null
          package_name?: string | null
          pax?: number | null
          payment_id?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          quantity?: number
          studio_location: string
          updated_at?: string | null
          user_email?: string | null
          user_name: string
          user_phone: string
        }
        Update: {
          amount?: number
          amount_inr?: number
          booking_date?: string | null
          booking_source?: string
          created_at?: string | null
          id?: string
          package_category?: string
          package_key?: string | null
          package_name?: string | null
          pax?: number | null
          payment_id?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          quantity?: number
          studio_location?: string
          updated_at?: string | null
          user_email?: string | null
          user_name?: string
          user_phone?: string
        }
        Relationships: []
      }
      event_order_items: {
        Row: {
          coin_amount: number | null
          coin_fulfilled_at: string | null
          coin_fulfilled_wallet_id: string | null
          coin_fulfillment_status: string
          created_at: string
          id: string
          line_total_inr: number
          order_id: string
          package_category: string
          package_key: string
          package_name: string
          pax: number | null
          phase_id: string | null
          phase_name: string | null
          phase_price_inr: number | null
          quantity: number
          selected_time_slots: Json
          unit_price_inr: number
        }
        Insert: {
          coin_amount?: number | null
          coin_fulfilled_at?: string | null
          coin_fulfilled_wallet_id?: string | null
          coin_fulfillment_status?: string
          created_at?: string
          id?: string
          line_total_inr: number
          order_id: string
          package_category: string
          package_key: string
          package_name: string
          pax?: number | null
          phase_id?: string | null
          phase_name?: string | null
          phase_price_inr?: number | null
          quantity: number
          selected_time_slots?: Json
          unit_price_inr: number
        }
        Update: {
          coin_amount?: number | null
          coin_fulfilled_at?: string | null
          coin_fulfilled_wallet_id?: string | null
          coin_fulfillment_status?: string
          created_at?: string
          id?: string
          line_total_inr?: number
          order_id?: string
          package_category?: string
          package_key?: string
          package_name?: string
          pax?: number | null
          phase_id?: string | null
          phase_name?: string | null
          phase_price_inr?: number | null
          quantity?: number
          selected_time_slots?: Json
          unit_price_inr?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "event_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_order_items_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "event_pricing_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      event_package_phase_limits: {
        Row: {
          active: boolean
          capacity: number
          created_at: string
          display_registration_boost: number
          id: string
          package_id: string
          phase_id: string
          price_inr: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          capacity?: number
          created_at?: string
          display_registration_boost?: number
          id?: string
          package_id: string
          phase_id: string
          price_inr: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          capacity?: number
          created_at?: string
          display_registration_boost?: number
          id?: string
          package_id?: string
          phase_id?: string
          price_inr?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_package_phase_limits_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "event_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_package_phase_limits_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "event_pricing_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      event_packages: {
        Row: {
          active: boolean
          category: string
          created_at: string
          description: string
          display_order: number
          featured: boolean
          id: string
          intensive_count: number | null
          name: string
          pax: number | null
          price_inr: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          category: string
          created_at?: string
          description?: string
          display_order?: number
          featured?: boolean
          id: string
          intensive_count?: number | null
          name: string
          pax?: number | null
          price_inr: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          description?: string
          display_order?: number
          featured?: boolean
          id?: string
          intensive_count?: number | null
          name?: string
          pax?: number | null
          price_inr?: number
          updated_at?: string
        }
        Relationships: []
      }
      event_pricing_phases: {
        Row: {
          active: boolean
          created_at: string
          display_order: number
          ends_at: string | null
          id: string
          name: string
          phase_key: string
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_order?: number
          ends_at?: string | null
          id?: string
          name: string
          phase_key: string
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_order?: number
          ends_at?: string | null
          id?: string
          name?: string
          phase_key?: string
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      event_orders: {
        Row: {
          attribution: Json
          booking_source: string
          cashfree_cf_order_id: string | null
          cashfree_order_id: string | null
          cashfree_order_response: Json | null
          cashfree_order_status: string | null
          cashfree_payment_session_id: string | null
          cashfree_payment_status: string | null
          checkout_token_expires_at: string | null
          checkout_token_hash: string | null
          confirmation_email_error: string | null
          confirmation_email_id: string | null
          confirmation_email_sent_at: string | null
          created_at: string
          customer_email: string
          customer_name: string
          customer_phone: string
          customer_studio: string | null
          id: string
          last_payment_verified_at: string | null
          paid_at: string | null
          payment_provider: string
          payment_reference: string | null
          payment_status: string
          razorpay_order_id: string | null
          razorpay_order_response: Json | null
          razorpay_payment_id: string | null
          razorpay_payment_response: Json | null
          razorpay_payment_status: string | null
          razorpay_signature: string | null
          total_amount_inr: number
          updated_at: string
        }
        Insert: {
          attribution?: Json
          booking_source?: string
          cashfree_cf_order_id?: string | null
          cashfree_order_id?: string | null
          cashfree_order_response?: Json | null
          cashfree_order_status?: string | null
          cashfree_payment_session_id?: string | null
          cashfree_payment_status?: string | null
          checkout_token_expires_at?: string | null
          checkout_token_hash?: string | null
          confirmation_email_error?: string | null
          confirmation_email_id?: string | null
          confirmation_email_sent_at?: string | null
          created_at?: string
          customer_email: string
          customer_name: string
          customer_phone: string
          customer_studio?: string | null
          id?: string
          last_payment_verified_at?: string | null
          paid_at?: string | null
          payment_provider?: string
          payment_reference?: string | null
          payment_status?: string
          razorpay_order_id?: string | null
          razorpay_order_response?: Json | null
          razorpay_payment_id?: string | null
          razorpay_payment_response?: Json | null
          razorpay_payment_status?: string | null
          razorpay_signature?: string | null
          total_amount_inr?: number
          updated_at?: string
        }
        Update: {
          attribution?: Json
          booking_source?: string
          cashfree_cf_order_id?: string | null
          cashfree_order_id?: string | null
          cashfree_order_response?: Json | null
          cashfree_order_status?: string | null
          cashfree_payment_session_id?: string | null
          cashfree_payment_status?: string | null
          checkout_token_expires_at?: string | null
          checkout_token_hash?: string | null
          confirmation_email_error?: string | null
          confirmation_email_id?: string | null
          confirmation_email_sent_at?: string | null
          created_at?: string
          customer_email?: string
          customer_name?: string
          customer_phone?: string
          customer_studio?: string | null
          id?: string
          last_payment_verified_at?: string | null
          paid_at?: string | null
          payment_provider?: string
          payment_reference?: string | null
          payment_status?: string
          razorpay_order_id?: string | null
          razorpay_order_response?: Json | null
          razorpay_payment_id?: string | null
          razorpay_payment_response?: Json | null
          razorpay_payment_status?: string | null
          razorpay_signature?: string | null
          total_amount_inr?: number
          updated_at?: string
        }
        Relationships: []
      }
      payment_gateway_settings: {
        Row: {
          active_provider: string
          cashfree_mode: string
          cashfree_enabled: boolean
          id: string
          razorpay_enabled: boolean
          razorpay_key_id: string | null
          updated_at: string
        }
        Insert: {
          active_provider?: string
          cashfree_mode?: string
          cashfree_enabled?: boolean
          id?: string
          razorpay_enabled?: boolean
          razorpay_key_id?: string | null
          updated_at?: string
        }
        Update: {
          active_provider?: string
          cashfree_mode?: string
          cashfree_enabled?: boolean
          id?: string
          razorpay_enabled?: boolean
          razorpay_key_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      coin_packages: {
        Row: {
          active: boolean
          coin_amount: number
          created_at: string
          display_order: number
          id: string
          inr_amount: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          coin_amount: number
          created_at?: string
          display_order?: number
          id?: string
          inr_amount: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          coin_amount?: number
          created_at?: string
          display_order?: number
          id?: string
          inr_amount?: number
          updated_at?: string
        }
        Relationships: []
      }
      game_sales: {
        Row: {
          coin_price: number
          created_at: string
          game_id: string | null
          id: string
          quantity: number
          sale_price: number
          transaction_id: string | null
        }
        Insert: {
          coin_price?: number
          created_at?: string
          game_id?: string | null
          id?: string
          quantity?: number
          sale_price: number
          transaction_id?: string | null
        }
        Update: {
          coin_price?: number
          created_at?: string
          game_id?: string | null
          id?: string
          quantity?: number
          sale_price?: number
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_sales_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_sales_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          available: boolean
          created_at: string
          description: string | null
          id: string
          name: string
          price: number
          studio: string
          updated_at: string
        }
        Insert: {
          available?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
          price?: number
          studio: string
          updated_at?: string
        }
        Update: {
          available?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          price?: number
          studio?: string
          updated_at?: string
        }
        Relationships: []
      }
      pos_items: {
        Row: {
          active: boolean
          category: string
          coin_price: number
          created_at: string
          display_order: number
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category: string
          coin_price?: number
          created_at?: string
          display_order?: number
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          coin_price?: number
          created_at?: string
          display_order?: number
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          assigned_game_id: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          assigned_game_id?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          assigned_game_id?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_assigned_game_id_fkey"
            columns: ["assigned_game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_permissions: {
        Row: {
          created_at: string
          game_id: string | null
          id: string
          permission_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          game_id?: string | null
          id?: string
          permission_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          game_id?: string | null
          id?: string
          permission_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_permissions_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          coin_amount: number
          created_at: string
          description: string
          game_id: string | null
          id: string
          inr_amount: number | null
          item_category: string | null
          item_name: string | null
          reference: string | null
          staff_user_id: string | null
          type: string
          wallet_id: string
        }
        Insert: {
          amount: number
          coin_amount?: number
          created_at?: string
          description: string
          game_id?: string | null
          id?: string
          inr_amount?: number | null
          item_category?: string | null
          item_name?: string | null
          reference?: string | null
          staff_user_id?: string | null
          type: string
          wallet_id: string
        }
        Update: {
          amount?: number
          coin_amount?: number
          created_at?: string
          description?: string
          game_id?: string | null
          id?: string
          inr_amount?: number | null
          item_category?: string | null
          item_name?: string | null
          reference?: string | null
          staff_user_id?: string | null
          type?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          attendee_name: string
          attendee_phone: string
          balance: number
          coin_balance: number
          created_at: string
          id: string
          status: string
          studio: string
          tag_id: string
          updated_at: string
        }
        Insert: {
          attendee_name: string
          attendee_phone: string
          balance?: number
          coin_balance?: number
          created_at?: string
          id?: string
          status?: string
          studio?: string
          tag_id: string
          updated_at?: string
        }
        Update: {
          attendee_name?: string
          attendee_phone?: string
          balance?: number
          coin_balance?: number
          created_at?: string
          id?: string
          status?: string
          studio?: string
          tag_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_event_order: {
        Args: {
          p_cart_items: Json
          p_customer_email: string
          p_customer_name: string
          p_customer_phone: string
          p_customer_studio?: string | null
        }
        Returns: {
          order_id: string
          total_amount_inr: number
        }[]
      }
      create_event_order_checkout: {
        Args: {
          p_attribution: Json
          p_cart_items: Json
          p_checkout_token_hash: string
          p_customer_email: string
          p_customer_name: string
          p_customer_phone: string
          p_customer_studio?: string | null
        }
        Returns: {
          order_id: string
          total_amount_inr: number
        }[]
      }
      credit_wallet_coins: {
        Args: {
          p_coin_package_id: string
          p_payment_reference: string
          p_wallet_id: string
        }
        Returns: {
          credited_coin_amount: number
          inr_amount: number
          new_coin_balance: number
          transaction_id: string
          wallet_id: string
        }[]
      }
      get_event_phase_package_stats: {
        Args: never
        Returns: {
          confirmed_quantity: number
          package_id: string
          pending_quantity: number
          phase_id: string
        }[]
      }
      get_current_user_role: { Args: never; Returns: string }
      spend_wallet_coins: {
        Args: {
          p_coin_amount: number
          p_game_id?: string | null
          p_item_category?: string | null
          p_item_name: string
          p_reference?: string | null
          p_transaction_type: string
          p_wallet_id: string
        }
        Returns: {
          new_coin_balance: number
          spent_coin_amount: number
          transaction_id: string
          wallet_id: string
        }[]
      }
      user_has_permission: {
        Args: { _game_id?: string; _permission_type: string; _user_id: string }
        Returns: boolean
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
  public: {
    Enums: {},
  },
} as const
