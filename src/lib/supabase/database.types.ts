
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
                    "admin_retries": number,"attempts": number,"created_at": string,"dedupe_key": string,"finished_at": string | null,"id": string,"job_type": Database["public"]['Enums']["ai_job_type"],"last_error_code": string | null,"next_retry_at": string | null,"queue_msg_id": number | null,"started_at": string | null,"status": Database["public"]['Enums']["ai_job_status"],"target_id": string,"target_version": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_retries"?: number,"attempts"?: number,"created_at"?: string,"dedupe_key": string,"finished_at"?: string | null,"id"?: string,"job_type": Database["public"]['Enums']["ai_job_type"],"last_error_code"?: string | null,"next_retry_at"?: string | null,"queue_msg_id"?: number | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["ai_job_status"],"target_id": string,"target_version"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "admin_retries"?: number,"attempts"?: number,"created_at"?: string,"dedupe_key"?: string,"finished_at"?: string | null,"id"?: string,"job_type"?: Database["public"]['Enums']["ai_job_type"],"last_error_code"?: string | null,"next_retry_at"?: string | null,"queue_msg_id"?: number | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["ai_job_status"],"target_id"?: string,"target_version"?: number | null,"updated_at"?: string
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
                    "case_id": string,"complaint_id": string,"linked_at": string,"linked_by": string | null,"matching_decision_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "case_id": string,"complaint_id": string,"linked_at"?: string,"linked_by"?: string | null,"matching_decision_id"?: string | null
                  }
                  Update: {
                    "case_id"?: string,"complaint_id"?: string,"linked_at"?: string,"linked_by"?: string | null,"matching_decision_id"?: string | null
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
    },{
      foreignKeyName: "case_reports_matching_decision_id_fkey"
      columns: ["matching_decision_id"]
isOneToOne: false
      referencedRelation: "match_candidates"
      referencedColumns: ["id"]
    }
                  ]
                },"case_work_orders": {
                  Row: {
                    "assigned_at": string,"cancelled_at": string | null,"case_id": string,"completed_at": string | null,"department_id": string,"id": string,"proposal_id": string | null,"source": Database["public"]['Enums']["work_order_source"],"status": Database["public"]['Enums']["work_order_status"],"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_at"?: string,"cancelled_at"?: string | null,"case_id": string,"completed_at"?: string | null,"department_id": string,"id"?: string,"proposal_id"?: string | null,"source": Database["public"]['Enums']["work_order_source"],"status"?: Database["public"]['Enums']["work_order_status"],"version"?: number
                  }
                  Update: {
                    "assigned_at"?: string,"cancelled_at"?: string | null,"case_id"?: string,"completed_at"?: string | null,"department_id"?: string,"id"?: string,"proposal_id"?: string | null,"source"?: Database["public"]['Enums']["work_order_source"],"status"?: Database["public"]['Enums']["work_order_status"],"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "case_work_orders_case_id_fkey"
      columns: ["case_id"]
isOneToOne: false
      referencedRelation: "maintenance_cases"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "case_work_orders_department_id_fkey"
      columns: ["department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "case_work_orders_proposal_fkey"
      columns: ["proposal_id"]
isOneToOne: false
      referencedRelation: "work_order_proposals"
      referencedColumns: ["id"]
    }
                  ]
                },"complaint_embeddings": {
                  Row: {
                    "complaint_id": string,"dimension": number,"embedding": string,"model": string,"text_hash": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "complaint_id": string,"dimension"?: number,"embedding": string,"model": string,"text_hash": string,"updated_at"?: string
                  }
                  Update: {
                    "complaint_id"?: string,"dimension"?: number,"embedding"?: string,"model"?: string,"text_hash"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "complaint_embeddings_complaint_id_fkey"
      columns: ["complaint_id"]
isOneToOne: true
      referencedRelation: "complaints"
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
                },"coordination_runs": {
                  Row: {
                    "case_id": string,"case_version": number,"created_at": string,"duration_ms": number | null,"id": string,"job_id": string | null,"model": string,"outcome": Database["public"]['Enums']["coordination_outcome"],"prompt_version": string,"reason_code": string | null,"tool_trace": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "case_id": string,"case_version": number,"created_at"?: string,"duration_ms"?: number | null,"id"?: string,"job_id"?: string | null,"model": string,"outcome": Database["public"]['Enums']["coordination_outcome"],"prompt_version": string,"reason_code"?: string | null,"tool_trace"?: NonNullable<Json>
                  }
                  Update: {
                    "case_id"?: string,"case_version"?: number,"created_at"?: string,"duration_ms"?: number | null,"id"?: string,"job_id"?: string | null,"model"?: string,"outcome"?: Database["public"]['Enums']["coordination_outcome"],"prompt_version"?: string,"reason_code"?: string | null,"tool_trace"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "coordination_runs_case_id_fkey"
      columns: ["case_id"]
isOneToOne: false
      referencedRelation: "maintenance_cases"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "coordination_runs_job_id_fkey"
      columns: ["job_id"]
isOneToOne: true
      referencedRelation: "ai_jobs"
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
                },"maintenance_alert_events": {
                  Row: {
                    "actor_id": string | null,"alert_id": string,"created_at": string,"event_type": string,"id": number,"note": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"alert_id": string,"created_at"?: string,"event_type": string,"id"?: never,"note"?: string | null
                  }
                  Update: {
                    "actor_id"?: string | null,"alert_id"?: string,"created_at"?: string,"event_type"?: string,"id"?: never,"note"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "maintenance_alert_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "maintenance_alert_events_alert_id_fkey"
      columns: ["alert_id"]
isOneToOne: false
      referencedRelation: "maintenance_alerts"
      referencedColumns: ["id"]
    }
                  ]
                },"maintenance_alerts": {
                  Row: {
                    "acknowledged_at": string | null,"acknowledged_by": string | null,"acknowledgement_note": string | null,"asset_id": string | null,"building_code": string | null,"case_ids": (string)[],"cleared_at": string | null,"first_seen_at": string,"id": string,"last_seen_at": string,"level": string,"location_id": string | null,"metric": NonNullable<Json>,"refresh_count": number,"rule_code": string,"status": Database["public"]['Enums']["alert_status"],"subject_key": string,"window_end": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "acknowledged_at"?: string | null,"acknowledged_by"?: string | null,"acknowledgement_note"?: string | null,"asset_id"?: string | null,"building_code"?: string | null,"case_ids": (string)[],"cleared_at"?: string | null,"first_seen_at"?: string,"id"?: string,"last_seen_at"?: string,"level": string,"location_id"?: string | null,"metric"?: NonNullable<Json>,"refresh_count"?: number,"rule_code": string,"status"?: Database["public"]['Enums']["alert_status"],"subject_key": string,"window_end": string,"window_start": string
                  }
                  Update: {
                    "acknowledged_at"?: string | null,"acknowledged_by"?: string | null,"acknowledgement_note"?: string | null,"asset_id"?: string | null,"building_code"?: string | null,"case_ids"?: (string)[],"cleared_at"?: string | null,"first_seen_at"?: string,"id"?: string,"last_seen_at"?: string,"level"?: string,"location_id"?: string | null,"metric"?: NonNullable<Json>,"refresh_count"?: number,"rule_code"?: string,"status"?: Database["public"]['Enums']["alert_status"],"subject_key"?: string,"window_end"?: string,"window_start"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "maintenance_alerts_acknowledged_by_fkey"
      columns: ["acknowledged_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "maintenance_alerts_asset_id_fkey"
      columns: ["asset_id"]
isOneToOne: false
      referencedRelation: "asset_registry"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "maintenance_alerts_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "maintenance_locations"
      referencedColumns: ["id"]
    }
                  ]
                },"maintenance_cases": {
                  Row: {
                    "asset_id": string | null,"assigned_department_id": string | null,"category": Database["public"]['Enums']["complaint_category"],"closed_at": string | null,"created_at": string,"id": string,"is_synthetic": boolean,"location_id": string | null,"merged_into_case_id": string | null,"opened_at": string,"priority": Database["public"]['Enums']["ticket_priority"],"reference_no": number,"resolved_at": string | null,"status": Database["public"]['Enums']["maintenance_case_status"],"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_id"?: string | null,"assigned_department_id"?: string | null,"category"?: Database["public"]['Enums']["complaint_category"],"closed_at"?: string | null,"created_at"?: string,"id"?: string,"is_synthetic"?: boolean,"location_id"?: string | null,"merged_into_case_id"?: string | null,"opened_at"?: string,"priority"?: Database["public"]['Enums']["ticket_priority"],"reference_no"?: never,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["maintenance_case_status"],"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "asset_id"?: string | null,"assigned_department_id"?: string | null,"category"?: Database["public"]['Enums']["complaint_category"],"closed_at"?: string | null,"created_at"?: string,"id"?: string,"is_synthetic"?: boolean,"location_id"?: string | null,"merged_into_case_id"?: string | null,"opened_at"?: string,"priority"?: Database["public"]['Enums']["ticket_priority"],"reference_no"?: never,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["maintenance_case_status"],"updated_at"?: string,"version"?: number
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
    },{
      foreignKeyName: "maintenance_cases_merged_into_case_id_fkey"
      columns: ["merged_into_case_id"]
isOneToOne: false
      referencedRelation: "maintenance_cases"
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
                },"maintenance_sla_policies": {
                  Row: {
                    "category": Database["public"]['Enums']["complaint_category"],"target_days": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category": Database["public"]['Enums']["complaint_category"],"target_days": number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "category"?: Database["public"]['Enums']["complaint_category"],"target_days"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "maintenance_sla_policies_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"match_candidates": {
                  Row: {
                    "candidate_case_id": string,"category_match": boolean,"complaint_id": string,"created_at": string,"decided_at": string | null,"decision": Database["public"]['Enums']["match_decision"],"id": string,"model": string,"reviewer_id": string | null,"same_asset": boolean,"same_building": boolean,"same_room": boolean,"score": number,"similarity": number
                  }
                  ComputedFields: never
                  Insert: {
                    "candidate_case_id": string,"category_match": boolean,"complaint_id": string,"created_at"?: string,"decided_at"?: string | null,"decision"?: Database["public"]['Enums']["match_decision"],"id"?: string,"model": string,"reviewer_id"?: string | null,"same_asset": boolean,"same_building": boolean,"same_room": boolean,"score": number,"similarity": number
                  }
                  Update: {
                    "candidate_case_id"?: string,"category_match"?: boolean,"complaint_id"?: string,"created_at"?: string,"decided_at"?: string | null,"decision"?: Database["public"]['Enums']["match_decision"],"id"?: string,"model"?: string,"reviewer_id"?: string | null,"same_asset"?: boolean,"same_building"?: boolean,"same_room"?: boolean,"score"?: number,"similarity"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "match_candidates_candidate_case_id_fkey"
      columns: ["candidate_case_id"]
isOneToOne: false
      referencedRelation: "maintenance_cases"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "match_candidates_complaint_id_fkey"
      columns: ["complaint_id"]
isOneToOne: false
      referencedRelation: "complaints"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "match_candidates_reviewer_id_fkey"
      columns: ["reviewer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
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
                },"repair_evidence": {
                  Row: {
                    "attachment_id": string,"case_id": string,"created_at": string,"evidence_kind": Database["public"]['Enums']["repair_evidence_kind"],"id": string,"uploaded_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attachment_id": string,"case_id": string,"created_at"?: string,"evidence_kind": Database["public"]['Enums']["repair_evidence_kind"],"id"?: string,"uploaded_by": string
                  }
                  Update: {
                    "attachment_id"?: string,"case_id"?: string,"created_at"?: string,"evidence_kind"?: Database["public"]['Enums']["repair_evidence_kind"],"id"?: string,"uploaded_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "repair_evidence_attachment_id_fkey"
      columns: ["attachment_id"]
isOneToOne: true
      referencedRelation: "evidence_attachments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "repair_evidence_case_id_fkey"
      columns: ["case_id"]
isOneToOne: false
      referencedRelation: "maintenance_cases"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "repair_evidence_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
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
                },"verification_reviews": {
                  Row: {
                    "after_attachment_id": string,"ai_result": Json | null,"ai_status": Database["public"]['Enums']["verification_ai_status"] | null,"analysed_at": string | null,"before_attachment_id": string | null,"case_id": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"explanation": string | null,"id": string,"job_id": string | null,"model": string | null,"prompt_version": string | null,"state": Database["public"]['Enums']["verification_state"],"uncertainty_flags": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "after_attachment_id": string,"ai_result"?: Json | null,"ai_status"?: Database["public"]['Enums']["verification_ai_status"] | null,"analysed_at"?: string | null,"before_attachment_id"?: string | null,"case_id": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"explanation"?: string | null,"id"?: string,"job_id"?: string | null,"model"?: string | null,"prompt_version"?: string | null,"state"?: Database["public"]['Enums']["verification_state"],"uncertainty_flags"?: (string)[]
                  }
                  Update: {
                    "after_attachment_id"?: string,"ai_result"?: Json | null,"ai_status"?: Database["public"]['Enums']["verification_ai_status"] | null,"analysed_at"?: string | null,"before_attachment_id"?: string | null,"case_id"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"explanation"?: string | null,"id"?: string,"job_id"?: string | null,"model"?: string | null,"prompt_version"?: string | null,"state"?: Database["public"]['Enums']["verification_state"],"uncertainty_flags"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "verification_reviews_after_attachment_id_fkey"
      columns: ["after_attachment_id"]
isOneToOne: true
      referencedRelation: "evidence_attachments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "verification_reviews_before_attachment_id_fkey"
      columns: ["before_attachment_id"]
isOneToOne: false
      referencedRelation: "evidence_attachments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "verification_reviews_case_id_fkey"
      columns: ["case_id"]
isOneToOne: false
      referencedRelation: "maintenance_cases"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "verification_reviews_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "verification_reviews_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "ai_jobs"
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
                },"work_order_proposals": {
                  Row: {
                    "case_id": string,"category": Database["public"]['Enums']["complaint_category"],"created_at": string,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"department_id": string,"expected_case_version": number,"id": string,"policy_reasons": (string)[],"priority": Database["public"]['Enums']["ticket_priority"],"rationale": string,"run_id": string,"status": Database["public"]['Enums']["proposal_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "case_id": string,"category": Database["public"]['Enums']["complaint_category"],"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"department_id": string,"expected_case_version": number,"id"?: string,"policy_reasons"?: (string)[],"priority": Database["public"]['Enums']["ticket_priority"],"rationale": string,"run_id": string,"status"?: Database["public"]['Enums']["proposal_status"]
                  }
                  Update: {
                    "case_id"?: string,"category"?: Database["public"]['Enums']["complaint_category"],"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"department_id"?: string,"expected_case_version"?: number,"id"?: string,"policy_reasons"?: (string)[],"priority"?: Database["public"]['Enums']["ticket_priority"],"rationale"?: string,"run_id"?: string,"status"?: Database["public"]['Enums']["proposal_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "work_order_proposals_case_id_fkey"
      columns: ["case_id"]
isOneToOne: false
      referencedRelation: "maintenance_cases"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_order_proposals_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_order_proposals_department_id_fkey"
      columns: ["department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "work_order_proposals_run_id_fkey"
      columns: ["run_id"]
isOneToOne: true
      referencedRelation: "coordination_runs"
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
"admin_acknowledge_alert":
{ Args: { "p_alert_id": string,"p_note"?: string }; Returns: undefined
                           },
"admin_decide_proposal":
{ Args: { "p_approve": boolean,"p_expected_case_version": number,"p_note"?: string,"p_proposal_id": string }; Returns: string
                           },
"admin_heatmap":
{ Args: { "p_building"?: string,"p_category"?: Database["public"]['Enums']["complaint_category"],"p_days"?: number,"p_department"?: string,"p_floor"?: number,"p_include_synthetic"?: boolean,"p_status"?: string }; Returns: Json
                           },
"admin_heatmap_room":
{ Args: { "p_category"?: Database["public"]['Enums']["complaint_category"],"p_days"?: number,"p_department"?: string,"p_include_synthetic"?: boolean,"p_location_id": string,"p_status"?: string }; Returns: Json
                           },
"admin_maintenance_insights":
{ Args: { "p_weeks"?: number }; Returns: Json
                           },
"admin_metrics":
{ Args: { "p_window_days"?: number }; Returns: Json
                           },
"admin_refresh_alerts":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_retry_ai_job":
{ Args: { "p_job_id": string }; Returns: {
              "admin_retries": number,"job_id": string,"status": Database["public"]['Enums']["ai_job_status"]
            }[]
                           },
"admin_set_category_sla":
{ Args: { "p_category": Database["public"]['Enums']["complaint_category"],"p_target_days": number }; Returns: undefined
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
"decide_repair_verification":
{ Args: { "p_confirm": boolean,"p_note"?: string,"p_review_id": string }; Returns: Database["public"]['Enums']["maintenance_case_status"]
                           },
"discard_evidence_upload":
{ Args: { "p_attachment_id": string }; Returns: undefined
                           },
"dismiss_match_candidates":
{ Args: { "p_complaint_id": string }; Returns: number
                           },
"finalize_evidence_upload":
{ Args: { "p_attachment_id": string,"p_byte_size": number,"p_mime_type": string,"p_sha256": string }; Returns: {
              "attachment_id": string,"job_id": string
            }[]
                           },
"finalize_repair_evidence_upload":
{ Args: { "p_attachment_id": string,"p_byte_size": number,"p_mime_type": string,"p_sha256": string }; Returns: {
              "attachment_id": string,"job_id": string,"review_id": string
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
"repair_verification_view":
{ Args: { "p_complaint_id": string }; Returns: Json
                           },
"request_case_coordination":
{ Args: { "p_case_id": string }; Returns: string
                           },
"request_duplicate_check":
{ Args: { "p_complaint_id": string }; Returns: string
                           },
"request_evidence_upload":
{ Args: { "p_byte_size": number,"p_complaint_id": string,"p_mime_type": string }; Returns: {
              "attachment_id": string,"object_path": string
            }[]
                           },
"request_repair_evidence_upload":
{ Args: { "p_byte_size": number,"p_case_id": string,"p_kind": Database["public"]['Enums']["repair_evidence_kind"],"p_mime_type": string }; Returns: {
              "attachment_id": string,"object_path": string
            }[]
                           },
"review_match_candidate":
{ Args: { "p_candidate_id": string,"p_decision": Database["public"]['Enums']["match_decision"],"p_expected_case_version": number }; Returns: {
              "candidate_id": string,"case_id": string,"decision": Database["public"]['Enums']["match_decision"]
            }[]
                           },
"review_visual_analysis":
{ Args: { "p_analysis_id": string,"p_corrected_category"?: Database["public"]['Enums']["complaint_category"],"p_decision": Database["public"]['Enums']["visual_review_decision"],"p_note"?: string }; Returns: number
                           },
"set_case_location":
{ Args: { "p_asset_id"?: string,"p_case_id": string,"p_expected_version": number,"p_location_id"?: string }; Returns: number
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
"worker_approved_routes":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"worker_asset_history":
{ Args: { "p_asset_id": string,"p_days"?: number }; Returns: Json
                           },
"worker_case_context":
{ Args: { "p_case_id": string }; Returns: Json
                           },
"worker_claim_ai_jobs":
{ Args: { "p_batch"?: number,"p_visibility_seconds"?: number }; Returns: {
              "attempt": number,"job_id": string,"job_type": Database["public"]['Enums']["ai_job_type"],"msg_id": number,"target_id": string
            }[]
                           },
"worker_complete_ai_job":
{ Args: { "p_attempt": number,"p_job_id": string,"p_msg_id": number }; Returns: Database["public"]['Enums']["ai_job_status"]
                           },
"worker_department_capacity":
{ Args: { "p_department_id": string }; Returns: Json
                           },
"worker_duplicate_features":
{ Args: { "p_complaint_id": string,"p_limit"?: number,"p_model": string }; Returns: {
              "case_id": string,"case_reference": number,"category_match": boolean,"same_asset": boolean,"same_building": boolean,"same_room": boolean,"similarity": number
            }[]
                           },
"worker_embedding_context":
{ Args: { "p_complaint_id": string }; Returns: {
              "building": string,"category": Database["public"]['Enums']["complaint_category"],"complaint_id": string,"description": string,"model": string,"room": string,"text_hash": string,"title": string
            }[]
                           },
"worker_fail_ai_job":
{ Args: { "p_attempt": number,"p_error_code": string,"p_job_id": string,"p_msg_id": number,"p_retry_delay_seconds"?: number,"p_retryable": boolean }; Returns: Database["public"]['Enums']["ai_job_status"]
                           },
"worker_finish_coordination":
{ Args: { "p_attempt": number,"p_auto_commit": boolean,"p_case_version": number,"p_duration_ms": number,"p_job_id": string,"p_model": string,"p_msg_id": number,"p_policy_reasons": (string)[],"p_prompt_version": string,"p_proposal": Json,"p_reason_code": string,"p_tool_trace": Json }; Returns: Json
                           },
"worker_related_cases":
{ Args: { "p_category": Database["public"]['Enums']["complaint_category"],"p_exclude_case": string,"p_location_id": string }; Returns: Json
                           },
"worker_save_embedding":
{ Args: { "p_attempt": number,"p_embedding": (number)[],"p_job_id": string,"p_model": string,"p_msg_id": number,"p_text_hash": string }; Returns: string
                           },
"worker_save_match_candidates":
{ Args: { "p_attempt": number,"p_candidates": Json,"p_job_id": string,"p_model": string,"p_msg_id": number }; Returns: number
                           },
"worker_save_verification":
{ Args: { "p_attempt": number,"p_job_id": string,"p_model": string,"p_msg_id": number,"p_prompt_version": string,"p_result": Json }; Returns: Json
                           },
"worker_save_visual_analysis":
{ Args: { "p_attempt": number,"p_job_id": string,"p_model": string,"p_msg_id": number,"p_prompt_version": string,"p_result": Json }; Returns: string
                           },
"worker_verification_context":
{ Args: { "p_review_id": string }; Returns: Json
                           },
"worker_visual_context":
{ Args: { "p_attachment_id": string }; Returns: {
              "attachment_id": string,"building": string,"byte_size": number,"complaint_id": string,"description": string,"mime_type": string,"object_path": string,"room": string,"sha256": string,"title": string
            }[]
                           }
          }
          Enums: {
            "agent_run_outcome": "running"|"routed"|"needs_review"|"superseded","agent_run_trigger": "submission"|"admin_retry","ai_job_status": "queued"|"running"|"succeeded"|"retry_wait"|"needs_review","ai_job_type": "visual_analysis"|"embedding"|"duplicate_match"|"coordination"|"repair_verify"|"insights_refresh","alert_status": "open"|"acknowledged"|"cleared","app_role": "student"|"department"|"admin","attachment_state": "pending"|"finalized"|"rejected","case_event_type": "opened"|"assigned"|"status_changed"|"updated"|"report_linked"|"merged"|"repair_evidence_added"|"verification_result"|"verification_decided","complaint_category": "unclassified"|"electrical"|"it_equipment"|"plumbing"|"furniture"|"sanitation"|"other","coordination_outcome": "committed"|"awaiting_approval"|"review_requested"|"superseded","image_quality": "usable"|"blurry"|"dark"|"unrelated","maintenance_case_status": "open"|"needs_review"|"assigned"|"in_progress"|"resolved"|"reopened"|"closed"|"merged","match_decision": "pending"|"accepted"|"rejected"|"superseded","proposal_status": "pending"|"committed"|"rejected"|"stale","repair_evidence_kind": "before"|"after","text_image_consistency": "consistent"|"inconsistent"|"unclear","ticket_actor_kind": "user"|"agent"|"rule"|"system","ticket_event_type": "created"|"assigned"|"acknowledged"|"status_changed"|"note_added"|"triage_started"|"review_requested"|"case_linked","ticket_priority": "unassessed"|"low"|"medium"|"high","ticket_state": "submitted"|"triaging"|"needs_review"|"assigned"|"in_progress"|"resolved"|"reopened"|"closed","verification_ai_status": "visually_improved"|"possibly_unresolved"|"inconclusive"|"not_comparable","verification_state": "pending"|"awaiting_decision"|"confirmed"|"rework"|"superseded","visual_review_decision": "confirmed"|"disputed"|"corrected","work_order_source": "ticket_routing"|"coordinator"|"admin_approved","work_order_status": "active"|"completed"|"cancelled"
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
            "agent_run_outcome": ["running", "routed", "needs_review", "superseded"],"agent_run_trigger": ["submission", "admin_retry"],"ai_job_status": ["queued", "running", "succeeded", "retry_wait", "needs_review"],"ai_job_type": ["visual_analysis", "embedding", "duplicate_match", "coordination", "repair_verify", "insights_refresh"],"alert_status": ["open", "acknowledged", "cleared"],"app_role": ["student", "department", "admin"],"attachment_state": ["pending", "finalized", "rejected"],"case_event_type": ["opened", "assigned", "status_changed", "updated", "report_linked", "merged", "repair_evidence_added", "verification_result", "verification_decided"],"complaint_category": ["unclassified", "electrical", "it_equipment", "plumbing", "furniture", "sanitation", "other"],"coordination_outcome": ["committed", "awaiting_approval", "review_requested", "superseded"],"image_quality": ["usable", "blurry", "dark", "unrelated"],"maintenance_case_status": ["open", "needs_review", "assigned", "in_progress", "resolved", "reopened", "closed", "merged"],"match_decision": ["pending", "accepted", "rejected", "superseded"],"proposal_status": ["pending", "committed", "rejected", "stale"],"repair_evidence_kind": ["before", "after"],"text_image_consistency": ["consistent", "inconsistent", "unclear"],"ticket_actor_kind": ["user", "agent", "rule", "system"],"ticket_event_type": ["created", "assigned", "acknowledged", "status_changed", "note_added", "triage_started", "review_requested", "case_linked"],"ticket_priority": ["unassessed", "low", "medium", "high"],"ticket_state": ["submitted", "triaging", "needs_review", "assigned", "in_progress", "resolved", "reopened", "closed"],"verification_ai_status": ["visually_improved", "possibly_unresolved", "inconclusive", "not_comparable"],"verification_state": ["pending", "awaiting_decision", "confirmed", "rework", "superseded"],"visual_review_decision": ["confirmed", "disputed", "corrected"],"work_order_source": ["ticket_routing", "coordinator", "admin_approved"],"work_order_status": ["active", "completed", "cancelled"]
          }
        }
} as const
