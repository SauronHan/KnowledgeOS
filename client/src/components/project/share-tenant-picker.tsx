import { useEffect, useState } from "react"
import { Check } from "lucide-react"
import { kosApiRequest } from "@/lib/api-client"

interface TenantInfo {
  id: number
  name: string
}

interface Props {
  selectedIds: number[] | null  // null = ALL, number[] = specific tenants
  onChange: (ids: number[] | null) => void
}

export function ShareTenantPicker({ selectedIds, onChange }: Props) {
  const [tenants, setTenants] = useState<TenantInfo[]>([])
  const allSelected = selectedIds === null

  useEffect(() => {
    kosApiRequest("/tenants").then((data: any) => {
      if (data?.status === "success" && Array.isArray(data.data)) {
        setTenants(data.data.map((t: any) => ({ id: t.id, name: t.name })))
      }
    }).catch(() => {})
  }, [])

  function toggleAll() {
    onChange(allSelected ? [] : null)
  }

  function toggleTenant(id: number) {
    if (selectedIds === null) {
      // Currently ALL, switching to specific → start with all but the clicked one
      onChange(tenants.filter(t => t.id !== id).map(t => t.id))
    } else {
      if (selectedIds.includes(id)) {
        const next = selectedIds.filter(x => x !== id)
        onChange(next.length ? next : [])
      } else {
        onChange([...selectedIds, id])
      }
    }
  }

  return (
    <div className="space-y-3">
      <Label>Visible to Tenants</Label>
      <div className="space-y-2 max-h-52 overflow-y-auto border rounded-md p-2">
        {/* ALL option */}
        <label className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer ${
          allSelected ? "bg-blue-50 text-blue-800" : "hover:bg-muted"
        }`}>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="w-4 h-4 text-blue-600 rounded"
          />
          <span className="font-medium">ALL</span>
          <span className="text-xs text-muted-foreground ml-auto">
            Future tenants will also see this project
          </span>
        </label>

        <div className="border-t" />
        {tenants.map((t) => (
          <label
            key={t.id}
            className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer ${
              allSelected || (selectedIds && selectedIds.includes(t.id))
                ? "bg-green-50 text-green-800"
                : "hover:bg-muted"
            }`}
          >
            <input
              type="checkbox"
              checked={allSelected || (selectedIds && selectedIds.includes(t.id))}
              onChange={() => toggleTenant(t.id)}
              disabled={allSelected}
              className="w-4 h-4 text-green-600 rounded"
            />
            {t.name}
          </label>
        ))}
        {tenants.length === 0 && (
          <p className="text-xs text-muted-foreground p-2">No tenants found. Create tenants first in Admin Web.</p>
        )}
      </div>
      {allSelected && (
        <p className="text-xs text-blue-600">
          <Check className="h-3 w-3 inline mr-1" />
          Project will be visible to ALL current and future tenants
        </p>
      )}
    </div>
  )
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">{children}</label>
}
