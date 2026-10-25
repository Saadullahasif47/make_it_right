
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "agent_runs": {
                  Row: {
                    "complaint_id": string,"duration_ms": number | null,"failure_code": string | null,"finished_at": string | null,"id": string,"model": string,"outcome": Database["public"]['Enums']["agent_run_outcome"],"prompt_version": string,"proposed_category": Database["public"]['Enums']["complaint_category"] | null,"proposed_department_id": string | null,"proposed_priority": Database["public"]['Enums']["ticket_priority"] | null,"requested_by": string | null,"started_at": string,"tool_calls": NonNullable<Json>,"trigger": Database["public"]['Enums']["agent_run_trigger"]
                  }
                  ComputedFields: never
                  Insert: {
                    "complaint_id": string,"duration_ms"?: number | null,"failure_code"?: string | null,"finished_at"?: string | null,"id"?: string,"model": string,"outcome"?: Database["public"]['Enums']["agent_run_outcome"],"prompt_version": string,"proposed_category"?: Database["public"]['Enums']["complaint_category"] | null,"proposed_department_id"?: string | null,"proposed_priority"?: Database["public"]['Enums']["ticket_priority"] | null,"requested_by"?: string | null,"started_at"?: string,"tool_calls"?: NonNullable<Json>,"trigger": Database["public"]['Enums']["agent_run_trigger"]
                  }
                  Update: {
                    "complaint_id"?: string,"duration_ms"?: number | null,"failure_code"?: string | null,"finished_at"?: string | null,"id"?: string,"model"?: string,"outcome"?: Database["public"]['Enums']["agent_run_outcome"],"prompt_version"?: string,"proposed_category"?: Database["public"]['Enums']["complaint_category"] | null,"proposed_department_id"?: string | null,"proposed_priority"?: Database["public"]['Enums']["ticket_priority"] | null,"requested_by"?: string | null,"started_at"?: string,"tool_calls"?: NonNullable<Json>,"trigger"?: Database["public"]['Enums']["agent_run_trigger"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_runs_complaint_id_fkey"
      columns: ["complaint_id"]
isOneToOne: false
      referencedRelation: "complaints"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_runs_proposed_department_id_fkey"
      columns: ["proposed_department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_runs_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"complaints": {
                  Row: {
                    "acknowledged_at": string | null,"assigned_department_id": string | null,"building": string,"category": Database["public"]['Enums']["complaint_category"],"created_at": string,"created_by": string,"description": string,"id": string,"priority": Database["public"]['Enums']["ticket_priority"],"reference_no": number,"room": string | null,"status": Database["public"]['Enums']["ticket_state"],"title": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "acknowledged_at"?: string | null,"assigned_department_id"?: string | null,"building": string,"category"?: Database["public"]['Enums']["complaint_category"],"created_at"?: string,"created_by": string,"description": string,"id"?: string,"priority"?: Database["public"]['Enums']["ticket_priority"],"reference_no"?: never,"room"?: string | null,"status"?: Database["public"]['Enums']["ticket_state"],"title": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "acknowledged_at"?: string | null,"assigned_department_id"?: string | null,"building"?: string,"category"?: Database["public"]['Enums']["complaint_category"],"created_at"?: string,"created_by"?: string,"description"?: string,"id"?: string,"priority"?: Database["public"]['Enums']["ticket_priority"],"reference_no"?: never,"room"?: string | null,"status"?: Database["public"]['Enums']["ticket_state"],"title"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "complaints_assigned_department_id_fkey"
      columns: ["assigned_department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "complaints_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"departments": {
                  Row: {
                    "code": string,"created_at": string,"id": string,"is_active": boolean,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"department_id": string | null,"display_name": string | null,"id": string,"role": Database["public"]['Enums']["app_role"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"department_id"?: string | null,"display_name"?: string | null,"id": string,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"department_id"?: string | null,"display_name"?: string | null,"id"?: string,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_department_id_fkey"
      columns: ["department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    }
                  ]
                },"routing_rules": {
                  Row: {
                    "category": Database["public"]['Enums']["complaint_category"],"department_id": string,"enabled": boolean,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category": Database["public"]['Enums']["complaint_category"],"department_id": string,"enabled"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "category"?: Database["public"]['Enums']["complaint_category"],"department_id"?: string,"enabled"?: boolean,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "routing_rules_department_id_fkey"
      columns: ["department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    }
                  ]
                },"submission_keys": {
                  Row: {
                    "actor_id": string,"complaint_id": string,"created_at": string,"idempotency_key": string,"request_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"complaint_id": string,"created_at"?: string,"idempotency_key": string,"request_hash": string
                  }
                  Update: {
                    "actor_id"?: string,"complaint_id"?: string,"created_at"?: string,"idempotency_key"?: string,"request_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "submission_keys_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "submission_keys_complaint_id_fkey"
      columns: ["complaint_id"]
isOneToOne: false
      referencedRelation: "complaints"
      referencedColumns: ["id"]
    }
                  ]
                },"ticket_events": {
                  Row: {
                    "actor_id": string | null,"actor_kind": Database["public"]['Enums']["ticket_actor_kind"],"actor_role": Database["public"]['Enums']["app_role"] | null,"category": Database["public"]['Enums']["complaint_category"] | null,"complaint_id": string,"created_at": string,"department_id": string | null,"event_type": Database["public"]['Enums']["ticket_event_type"],"id": number,"new_status": Database["public"]['Enums']["ticket_state"] | null,"note": string | null,"previous_status": Database["public"]['Enums']["ticket_state"] | null,"priority": Database["public"]['Enums']["ticket_priority"] | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"actor_kind": Database["public"]['Enums']["ticket_actor_kind"],"actor_role"?: Database["public"]['Enums']["app_role"] | null,"category"?: Database["public"]['Enums']["complaint_category"] | null,"complaint_id": string,"created_at"?: string,"department_id"?: string | null,"event_type": Database["public"]['Enums']["ticket_event_type"],"id"?: never,"new_status"?: Database["public"]['Enums']["ticket_state"] | null,"note"?: string | null,"previous_status"?: Database["public"]['Enums']["ticket_state"] | null,"priority"?: Database["public"]['Enums']["ticket_priority"] | null
                  }
                  Update: {
                    "actor_id"?: string | null,"actor_kind"?: Database["public"]['Enums']["ticket_actor_kind"],"actor_role"?: Database["public"]['Enums']["app_role"] | null,"category"?: Database["public"]['Enums']["complaint_category"] | null,"complaint_id"?: string,"created_at"?: string,"department_id"?: string | null,"event_type"?: Database["public"]['Enums']["ticket_event_type"],"id"?: never,"new_status"?: Database["public"]['Enums']["ticket_state"] | null,"note"?: string | null,"previous_status"?: Database["public"]['Enums']["ticket_state"] | null,"priority"?: Database["public"]['Enums']["ticket_priority"] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ticket_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ticket_events_complaint_id_fkey"
      columns: ["complaint_id"]
isOneToOne: false
      referencedRelation: "complaints"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ticket_events_department_id_fkey"
      columns: ["department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "acknowledge_ticket":
{ Args: { "p_expected_version": number,"p_ticket_id": string }; Returns: {
              "acknowledged_at": string,"id": string,"version": number
            }[]
                           },
"add_ticket_note":
{ Args: { "p_note": string,"p_ticket_id": string }; Returns: {
              "event_id": number
            }[]
                           },
"agent_begin_run":
{ Args: { "p_model": string,"p_prompt_version": string,"p_requested_by": string,"p_ticket_id": string,"p_trigger": Database["public"]['Enums']["agent_run_trigger"] }; Returns: {
              "description": string,"run_id": string,"ticket_version": number,"title": string
            }[]
                           },
"agent_finish_run":
{ Args: { "p_category"?: Database["public"]['Enums']["complaint_category"],"p_department_id"?: string,"p_duration_ms"?: number,"p_expected_version": number,"p_failure_code"?: string,"p_outcome": Database["public"]['Enums']["agent_run_outcome"],"p_priority"?: Database["public"]['Enums']["ticket_priority"],"p_reason"?: string,"p_run_id": string,"p_tool_calls"?: Json }; Returns: {
              "outcome": Database["public"]['Enums']["agent_run_outcome"],"status": Database["public"]['Enums']["ticket_state"],"version": number
            }[]
                           },
"assign_ticket":
{ Args: { "p_category": Database["public"]['Enums']["complaint_category"],"p_department_id": string,"p_expected_version": number,"p_note"?: string,"p_priority": Database["public"]['Enums']["ticket_priority"],"p_ticket_id": string }; Returns: {
              "assigned_department_id": string,"id": string,"status": Database["public"]['Enums']["ticket_state"],"version": number
            }[]
                           },
"create_ticket":
{ Args: { "p_building": string,"p_description": string,"p_idempotency_key": string,"p_room": string,"p_title": string }; Returns: {
              "created": boolean,"id": string,"reference_no": number,"status": Database["public"]['Enums']["ticket_state"]
            }[]
                           },
"list_complaints":
{ Args: { "p_cursor_created_at"?: string,"p_cursor_id"?: string,"p_cursor_priority"?: Database["public"]['Enums']["ticket_priority"],"p_limit"?: number,"p_sort"?: string,"p_statuses"?: (Database["public"]['Enums']["ticket_state"])[] }; Returns: {
              "acknowledged_at": string | null,
"assigned_department_id": string | null,
"building": string,
"category": Database["public"]['Enums']["complaint_category"],
"created_at": string,
"created_by": string,
"description": string,
"id": string,
"priority": Database["public"]['Enums']["ticket_priority"],
"reference_no": number,
"room": string | null,
"status": Database["public"]['Enums']["ticket_state"],
"title": string,
"updated_at": string,
"version": number
            }[]
                          SetofOptions: {
        from: "*"
        to: "complaints"
        isOneToOne: false
        isSetofReturn: true
      } },
"ticket_transition_rules":
{ Args: Record<PropertyKey, never>; Returns: {
              "actor_role": Database["public"]['Enums']["app_role"],"from_state": Database["public"]['Enums']["ticket_state"],"to_state": Database["public"]['Enums']["ticket_state"]
            }[]
                           },
"transition_ticket":
{ Args: { "p_expected_version": number,"p_note"?: string,"p_target": Database["public"]['Enums']["ticket_state"],"p_ticket_id": string }; Returns: {
              "id": string,"status": Database["public"]['Enums']["ticket_state"],"version": number
            }[]
                           }
          }
          Enums: {
            "agent_run_outcome": "running"|"routed"|"needs_review"|"superseded","agent_run_trigger": "submission"|"admin_retry","app_role": "student"|"department"|"admin","complaint_category": "unclassified"|"electrical"|"it_equipment"|"plumbing"|"furniture"|"sanitation"|"other","ticket_actor_kind": "user"|"agent"|"rule"|"system","ticket_event_type": "created"|"assigned"|"acknowledged"|"status_changed"|"note_added"|"triage_started"|"review_requested","ticket_priority": "unassessed"|"low"|"medium"|"high","ticket_state": "submitted"|"triaging"|"needs_review"|"assigned"|"in_progress"|"resolved"|"reopened"|"closed"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "agent_run_outcome": ["running", "routed", "needs_review", "superseded"],"agent_run_trigger": ["submission", "admin_retry"],"app_role": ["student", "department", "admin"],"complaint_category": ["unclassified", "electrical", "it_equipment", "plumbing", "furniture", "sanitation", "other"],"ticket_actor_kind": ["user", "agent", "rule", "system"],"ticket_event_type": ["created", "assigned", "acknowledged", "status_changed", "note_added", "triage_started", "review_requested"],"ticket_priority": ["unassessed", "low", "medium", "high"],"ticket_state": ["submitted", "triaging", "needs_review", "assigned", "in_progress", "resolved", "reopened", "closed"]
          }
        }
} as const
