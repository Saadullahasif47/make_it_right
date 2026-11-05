
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
                },"ai_jobs": {
                  Row: {
                    "admin_retries": number,"attempts": number,"created_at": string,"dedupe_key": string,"finished_at": string | null,"id": string,"job_type": Database["public"]['Enums']["ai_job_type"],"last_error_code": string | null,"next_retry_at": string | null,"queue_msg_id": number | null,"started_at": string | null,"status": Database["public"]['Enums']["ai_job_status"],"target_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_retries"?: number,"attempts"?: number,"created_at"?: string,"dedupe_key": string,"finished_at"?: string | null,"id"?: string,"job_type": Database["public"]['Enums']["ai_job_type"],"last_error_code"?: string | null,"next_retry_at"?: string | null,"queue_msg_id"?: number | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["ai_job_status"],"target_id": string,"updated_at"?: string
                  }
                  Update: {
                    "admin_retries"?: number,"attempts"?: number,"created_at"?: string,"dedupe_key"?: string,"finished_at"?: string | null,"id"?: string,"job_type"?: Database["public"]['Enums']["ai_job_type"],"last_error_code"?: string | null,"next_retry_at"?: string | null,"queue_msg_id"?: number | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["ai_job_status"],"target_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"asset_registry": {
                  Row: {
                    "asset_code": string,"asset_type": string,"created_at": string,"id": string,"is_active": boolean,"label": string,"location_id": string,"serial_number": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_code": string,"asset_type": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"label": string,"location_id": string,"serial_number"?: string | null
                  }
                  Update: {
                    "asset_code"?: string,"asset_type"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"label"?: string,"location_id"?: string,"serial_number"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "asset_registry_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "maintenance_locations"
      referencedColumns: ["id"]
    }
                  ]
                },"case_events": {
                  Row: {
                    "actor_id": string | null,"actor_kind": Database["public"]['Enums']["ticket_actor_kind"],"case_id": string,"complaint_id": string | null,"created_at": string,"department_id": string | null,"event_type": Database["public"]['Enums']["case_event_type"],"id": number,"new_status": Database["public"]['Enums']["maintenance_case_status"] | null,"note": string | null,"previous_status": Database["public"]['Enums']["maintenance_case_status"] | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"actor_kind": Database["public"]['Enums']["ticket_actor_kind"],"case_id": string,"complaint_id"?: string | null,"created_at"?: string,"department_id"?: string | null,"event_type": Database["public"]['Enums']["case_event_type"],"id"?: never,"new_status"?: Database["public"]['Enums']["maintenance_case_status"] | null,"note"?: string | null,"previous_status"?: Database["public"]['Enums']["maintenance_case_status"] | null
                  }
                  Update: {
                    "actor_id"?: string | null,"actor_kind"?: Database["public"]['Enums']["ticket_actor_kind"],"case_id"?: string,"complaint_id"?: string | null,"created_at"?: string,"department_id"?: string | null,"event_type"?: Database["public"]['Enums']["case_event_type"],"id"?: never,"new_status"?: Database["public"]['Enums']["maintenance_case_status"] | null,"note"?: string | null,"previous_status"?: Database["public"]['Enums']["maintenance_case_status"] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "case_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "case_events_case_id_fkey"
      columns: ["case_id"]
isOneToOne: false
      referencedRelation: "maintenance_cases"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "case_events_complaint_id_fkey"
      columns: ["complaint_id"]
isOneToOne: false
      referencedRelation: "complaints"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "case_events_department_id_fkey"
      columns: ["department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    }
                  ]
                },"case_reports": {
                  Row: {
                    "case_id": string,"complaint_id": string,"linked_at": string,"linked_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "case_id": string,"complaint_id": string,"linked_at"?: string,"linked_by"?: string | null
                  }
                  Update: {
                    "case_id"?: string,"complaint_id"?: string,"linked_at"?: string,"linked_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "case_reports_case_id_fkey"
      columns: ["case_id"]
isOneToOne: false
      referencedRelation: "maintenance_cases"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "case_reports_complaint_id_fkey"
      columns: ["complaint_id"]
isOneToOne: true
      referencedRelation: "complaints"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "case_reports_linked_by_fkey"
      columns: ["linked_by"]
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
                },"config_changes": {
                  Row: {
                    "after_value": NonNullable<Json>,"before_value": Json | null,"changed_by": string,"created_at": string,"entity": string,"entity_key": string,"id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "after_value": NonNullable<Json>,"before_value"?: Json | null,"changed_by": string,"created_at"?: string,"entity": string,"entity_key": string,"id"?: never
                  }
                  Update: {
                    "after_value"?: NonNullable<Json>,"before_value"?: Json | null,"changed_by"?: string,"created_at"?: string,"entity"?: string,"entity_key"?: string,"id"?: never
                  }
                  Relationships: [
                    
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
                },"evidence_attachments": {
                  Row: {
                    "bucket": string,"byte_size": number,"case_id": string | null,"complaint_id": string | null,"created_at": string,"finalized_at": string | null,"id": string,"mime_type": string,"object_path": string,"sha256": string | null,"state": Database["public"]['Enums']["attachment_state"],"uploaded_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket"?: string,"byte_size": number,"case_id"?: string | null,"complaint_id"?: string | null,"created_at"?: string,"finalized_at"?: string | null,"id"?: string,"mime_type": string,"object_path": string,"sha256"?: string | null,"state"?: Database["public"]['Enums']["attachment_state"],"uploaded_by": string
                  }
                  Update: {
                    "bucket"?: string,"byte_size"?: number,"case_id"?: string | null,"complaint_id"?: string | null,"created_at"?: string,"finalized_at"?: string | null,"id"?: string,"mime_type"?: string,"object_path"?: string,"sha256"?: string | null,"state"?: Database["public"]['Enums']["attachment_state"],"uploaded_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "evidence_attachments_case_id_fkey"
      columns: ["case_id"]
isOneToOne: false
      referencedRelation: "maintenance_cases"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "evidence_attachments_complaint_id_fkey"
      columns: ["complaint_id"]
isOneToOne: false
      referencedRelation: "complaints"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "evidence_attachments_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"maintenance_cases": {
                  Row: {
                    "asset_id": string | null,"assigned_department_id": string | null,"category": Database["public"]['Enums']["complaint_category"],"closed_at": string | null,"created_at": string,"id": string,"is_synthetic": boolean,"location_id": string | null,"opened_at": string,"priority": Database["public"]['Enums']["ticket_priority"],"reference_no": number,"resolved_at": string | null,"status": Database["public"]['Enums']["maintenance_case_status"],"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_id"?: string | null,"assigned_department_id"?: string | null,"category"?: Database["public"]['Enums']["complaint_category"],"closed_at"?: string | null,"created_at"?: string,"id"?: string,"is_synthetic"?: boolean,"location_id"?: string | null,"opened_at"?: string,"priority"?: Database["public"]['Enums']["ticket_priority"],"reference_no"?: never,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["maintenance_case_status"],"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "asset_id"?: string | null,"assigned_department_id"?: string | null,"category"?: Database["public"]['Enums']["complaint_category"],"closed_at"?: string | null,"created_at"?: string,"id"?: string,"is_synthetic"?: boolean,"location_id"?: string | null,"opened_at"?: string,"priority"?: Database["public"]['Enums']["ticket_priority"],"reference_no"?: never,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["maintenance_case_status"],"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "maintenance_cases_asset_in_location"
      columns: ["asset_id","location_id"]
isOneToOne: false
      referencedRelation: "asset_registry"
      referencedColumns: ["id","location_id"]
    },{
      foreignKeyName: "maintenance_cases_assigned_department_id_fkey"
      columns: ["assigned_department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "maintenance_cases_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "maintenance_locations"
      referencedColumns: ["id"]
    }
                  ]
                },"maintenance_locations": {
                  Row: {
                    "building_code": string,"building_name": string,"created_at": string,"display_name": string,"floor": number,"id": string,"is_active": boolean,"map_x": number | null,"map_y": number | null,"room_code": string
                  }
                  ComputedFields: never
                  Insert: {
                    "building_code": string,"building_name": string,"created_at"?: string,"display_name": string,"floor": number,"id"?: string,"is_active"?: boolean,"map_x"?: number | null,"map_y"?: number | null,"room_code": string
                  }
                  Update: {
                    "building_code"?: string,"building_name"?: string,"created_at"?: string,"display_name"?: string,"floor"?: number,"id"?: string,"is_active"?: boolean,"map_x"?: number | null,"map_y"?: number | null,"room_code"?: string
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
                },"visual_analyses": {
                  Row: {
                    "attachment_id": string,"complaint_id": string,"created_at": string,"explanation": string,"id": string,"image_quality": Database["public"]['Enums']["image_quality"],"job_id": string | null,"model": string,"needs_human_review": boolean,"not_visible_or_uncertain": (string)[],"possible_issue": string,"prompt_version": string,"severity_hint": Database["public"]['Enums']["ticket_priority"],"suggested_category": Database["public"]['Enums']["complaint_category"] | null,"text_consistency": Database["public"]['Enums']["text_image_consistency"],"uncertainty_flags": (string)[],"visible_observations": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "attachment_id": string,"complaint_id": string,"created_at"?: string,"explanation": string,"id"?: string,"image_quality": Database["public"]['Enums']["image_quality"],"job_id"?: string | null,"model": string,"needs_human_review": boolean,"not_visible_or_uncertain"?: (string)[],"possible_issue": string,"prompt_version": string,"severity_hint": Database["public"]['Enums']["ticket_priority"],"suggested_category"?: Database["public"]['Enums']["complaint_category"] | null,"text_consistency": Database["public"]['Enums']["text_image_consistency"],"uncertainty_flags"?: (string)[],"visible_observations": (string)[]
                  }
                  Update: {
                    "attachment_id"?: string,"complaint_id"?: string,"created_at"?: string,"explanation"?: string,"id"?: string,"image_quality"?: Database["public"]['Enums']["image_quality"],"job_id"?: string | null,"model"?: string,"needs_human_review"?: boolean,"not_visible_or_uncertain"?: (string)[],"possible_issue"?: string,"prompt_version"?: string,"severity_hint"?: Database["public"]['Enums']["ticket_priority"],"suggested_category"?: Database["public"]['Enums']["complaint_category"] | null,"text_consistency"?: Database["public"]['Enums']["text_image_consistency"],"uncertainty_flags"?: (string)[],"visible_observations"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "visual_analyses_attachment_id_fkey"
      columns: ["attachment_id"]
isOneToOne: false
      referencedRelation: "evidence_attachments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visual_analyses_complaint_id_fkey"
      columns: ["complaint_id"]
isOneToOne: false
      referencedRelation: "complaints"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visual_analyses_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "ai_jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"visual_analysis_reviews": {
                  Row: {
                    "analysis_id": string,"corrected_category": Database["public"]['Enums']["complaint_category"] | null,"created_at": string,"decision": Database["public"]['Enums']["visual_review_decision"],"id": number,"note": string | null,"reviewer_id": string | null,"reviewer_role": Database["public"]['Enums']["app_role"]
                  }
                  ComputedFields: never
                  Insert: {
                    "analysis_id": string,"corrected_category"?: Database["public"]['Enums']["complaint_category"] | null,"created_at"?: string,"decision": Database["public"]['Enums']["visual_review_decision"],"id"?: never,"note"?: string | null,"reviewer_id"?: string | null,"reviewer_role": Database["public"]['Enums']["app_role"]
                  }
                  Update: {
                    "analysis_id"?: string,"corrected_category"?: Database["public"]['Enums']["complaint_category"] | null,"created_at"?: string,"decision"?: Database["public"]['Enums']["visual_review_decision"],"id"?: never,"note"?: string | null,"reviewer_id"?: string | null,"reviewer_role"?: Database["public"]['Enums']["app_role"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "visual_analysis_reviews_analysis_id_fkey"
      columns: ["analysis_id"]
isOneToOne: false
      referencedRelation: "visual_analyses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visual_analysis_reviews_reviewer_id_fkey"
      columns: ["reviewer_id"]
isOneToOne: false
      referencedRelation: "profiles"
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
"admin_metrics":
{ Args: { "p_window_days"?: number }; Returns: Json
                           },
"admin_retry_ai_job":
{ Args: { "p_job_id": string }; Returns: {
              "admin_retries": number,"job_id": string,"status": Database["public"]['Enums']["ai_job_status"]
            }[]
                           },
"admin_set_department_active":
{ Args: { "p_active": boolean,"p_department_id": string }; Returns: {
              "id": string,"is_active": boolean,"routes_affected": number
            }[]
                           },
"admin_set_routing_rule":
{ Args: { "p_category": Database["public"]['Enums']["complaint_category"],"p_department_id": string,"p_enabled": boolean }; Returns: {
              "category": Database["public"]['Enums']["complaint_category"],"department_id": string,"enabled": boolean
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
"discard_evidence_upload":
{ Args: { "p_attachment_id": string }; Returns: undefined
                           },
"finalize_evidence_upload":
{ Args: { "p_attachment_id": string,"p_byte_size": number,"p_mime_type": string,"p_sha256": string }; Returns: {
              "attachment_id": string,"job_id": string
            }[]
                           },
"list_complaints":
{ Args: { "p_cursor_created_at"?: string,"p_cursor_id"?: string,"p_cursor_priority"?: Database["public"]['Enums']["ticket_priority"],"p_limit"?: number,"p_query"?: string,"p_sort"?: string,"p_statuses"?: (Database["public"]['Enums']["ticket_state"])[] }; Returns: {
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
"photo_analysis_states":
{ Args: { "p_complaint_id": string }; Returns: {
              "attachment_id": string,"job_status": Database["public"]['Enums']["ai_job_status"]
            }[]
                           },
"request_evidence_upload":
{ Args: { "p_byte_size": number,"p_complaint_id": string,"p_mime_type": string }; Returns: {
              "attachment_id": string,"object_path": string
            }[]
                           },
"review_visual_analysis":
{ Args: { "p_analysis_id": string,"p_corrected_category"?: Database["public"]['Enums']["complaint_category"],"p_decision": Database["public"]['Enums']["visual_review_decision"],"p_note"?: string }; Returns: number
                           },
"ticket_transition_rules":
{ Args: Record<PropertyKey, never>; Returns: {
              "actor_role": Database["public"]['Enums']["app_role"],"from_state": Database["public"]['Enums']["ticket_state"],"to_state": Database["public"]['Enums']["ticket_state"]
            }[]
                           },
"transition_ticket":
{ Args: { "p_expected_version": number,"p_note"?: string,"p_target": Database["public"]['Enums']["ticket_state"],"p_ticket_id": string }; Returns: {
              "id": string,"status": Database["public"]['Enums']["ticket_state"],"version": number
            }[]
                           },
"worker_claim_ai_jobs":
{ Args: { "p_batch"?: number,"p_visibility_seconds"?: number }; Returns: {
              "attempt": number,"job_id": string,"job_type": Database["public"]['Enums']["ai_job_type"],"msg_id": number,"target_id": string
            }[]
                           },
"worker_complete_ai_job":
{ Args: { "p_attempt": number,"p_job_id": string,"p_msg_id": number }; Returns: Database["public"]['Enums']["ai_job_status"]
                           },
"worker_fail_ai_job":
{ Args: { "p_attempt": number,"p_error_code": string,"p_job_id": string,"p_msg_id": number,"p_retry_delay_seconds"?: number,"p_retryable": boolean }; Returns: Database["public"]['Enums']["ai_job_status"]
                           },
"worker_save_visual_analysis":
{ Args: { "p_attempt": number,"p_job_id": string,"p_model": string,"p_msg_id": number,"p_prompt_version": string,"p_result": Json }; Returns: string
                           },
"worker_visual_context":
{ Args: { "p_attachment_id": string }; Returns: {
              "attachment_id": string,"building": string,"byte_size": number,"complaint_id": string,"description": string,"mime_type": string,"object_path": string,"room": string,"sha256": string,"title": string
            }[]
                           }
          }
          Enums: {
            "agent_run_outcome": "running"|"routed"|"needs_review"|"superseded","agent_run_trigger": "submission"|"admin_retry","ai_job_status": "queued"|"running"|"succeeded"|"retry_wait"|"needs_review","ai_job_type": "visual_analysis"|"embedding"|"duplicate_match"|"coordination"|"repair_verify"|"insights_refresh","app_role": "student"|"department"|"admin","attachment_state": "pending"|"finalized"|"rejected","case_event_type": "opened"|"assigned"|"status_changed"|"updated","complaint_category": "unclassified"|"electrical"|"it_equipment"|"plumbing"|"furniture"|"sanitation"|"other","image_quality": "usable"|"blurry"|"dark"|"unrelated","maintenance_case_status": "open"|"needs_review"|"assigned"|"in_progress"|"resolved"|"reopened"|"closed","text_image_consistency": "consistent"|"inconsistent"|"unclear","ticket_actor_kind": "user"|"agent"|"rule"|"system","ticket_event_type": "created"|"assigned"|"acknowledged"|"status_changed"|"note_added"|"triage_started"|"review_requested","ticket_priority": "unassessed"|"low"|"medium"|"high","ticket_state": "submitted"|"triaging"|"needs_review"|"assigned"|"in_progress"|"resolved"|"reopened"|"closed","visual_review_decision": "confirmed"|"disputed"|"corrected"
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
            "agent_run_outcome": ["running", "routed", "needs_review", "superseded"],"agent_run_trigger": ["submission", "admin_retry"],"ai_job_status": ["queued", "running", "succeeded", "retry_wait", "needs_review"],"ai_job_type": ["visual_analysis", "embedding", "duplicate_match", "coordination", "repair_verify", "insights_refresh"],"app_role": ["student", "department", "admin"],"attachment_state": ["pending", "finalized", "rejected"],"case_event_type": ["opened", "assigned", "status_changed", "updated"],"complaint_category": ["unclassified", "electrical", "it_equipment", "plumbing", "furniture", "sanitation", "other"],"image_quality": ["usable", "blurry", "dark", "unrelated"],"maintenance_case_status": ["open", "needs_review", "assigned", "in_progress", "resolved", "reopened", "closed"],"text_image_consistency": ["consistent", "inconsistent", "unclear"],"ticket_actor_kind": ["user", "agent", "rule", "system"],"ticket_event_type": ["created", "assigned", "acknowledged", "status_changed", "note_added", "triage_started", "review_requested"],"ticket_priority": ["unassessed", "low", "medium", "high"],"ticket_state": ["submitted", "triaging", "needs_review", "assigned", "in_progress", "resolved", "reopened", "closed"],"visual_review_decision": ["confirmed", "disputed", "corrected"]
          }
        }
} as const
