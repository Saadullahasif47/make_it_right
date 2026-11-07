"use client";

import { MapPin } from "lucide-react";
import { useActionState } from "react";

import { inputClassName } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { IDLE_FORM_STATE } from "@/lib/forms/form-state";

import { setCaseLocationAction } from "../location-actions";

export interface PlaceOption {
  readonly id: string;
  readonly label: string;
  readonly group: string;
}

export function LocationForm({
  complaintId,
  caseId,
  version,
  locationId,
  assetId,
  rooms,
  assets,
}: {
  readonly complaintId: string;
  readonly caseId: string;
  readonly version: number;
  readonly locationId: string | null;
  readonly assetId: string | null;
  readonly rooms: readonly PlaceOption[];
  readonly assets: readonly PlaceOption[];
}) {
  const [state, action] = useActionState(setCaseLocationAction, IDLE_FORM_STATE);
  const groups = (options: readonly PlaceOption[]) => [...new Set(options.map((o) => o.group))];
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="complaintId" value={complaintId} />
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <label className="grid gap-1 text-sm font-medium text-ink">
        Room
        <select name="locationId" defaultValue={locationId ?? ""} className={inputClassName}>
          <option value="">Unknown</option>
          {groups(rooms).map((group) => (
            <optgroup key={group} label={group}>
              {rooms
                .filter((room) => room.group === group)
                .map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium text-ink">
        Equipment (optional)
        <select name="assetId" defaultValue={assetId ?? ""} className={inputClassName}>
          <option value="">None</option>
          {groups(assets).map((group) => (
            <optgroup key={group} label={group}>
              {assets
                .filter((asset) => asset.group === group)
                .map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <span className="text-xs font-normal text-ink-muted">
          Choosing equipment sets its room. Codes keep similar equipment apart.
        </span>
      </label>
      {state.status === "error" && state.message !== undefined ? (
        <Notice tone="error">{state.message}</Notice>
      ) : null}
      <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
        <MapPin aria-hidden="true" className="size-4" />
        Save location
      </SubmitButton>
    </form>
  );
}
