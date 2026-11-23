import { useMemo } from 'react'
import { useAppStore } from '@/store/index'
import {
  useAgentPickerInventoryEntries,
  type AgentPickerInventorySource
} from '../../agent/agent-picker-inventory-source'
import {
  buildAgentPickerLaunchOptions,
  buildCustomAgentLaunchOptions
} from './tab-agent-launch-options'
import { launchableCustomAgents } from '../../agent/launch-menu/custom-agent-menu-rows'
import TabBarCreateEntry from './TabBarCreateEntry'
import type { TabBarCreateEntryProps } from './tab-create-entry-props'

// Subscribe inside the menu so inventory updates do not re-render the tab bar.
export function TabBarAgentPickerEntry({
  inventory,
  hideAgents = false,
  ...props
}: Omit<TabBarCreateEntryProps, 'agentPickerEntries' | 'agentOptions'> & {
  inventory: AgentPickerInventorySource
  hideAgents?: boolean
}): React.JSX.Element {
  const entries = useAgentPickerInventoryEntries(inventory)
  const commandOverrides = useAppStore((state) => state.settings?.agentCmdOverrides)
  const customAgents = useAppStore((state) => state.settings?.customTuiAgents)
  const launchOptions = useMemo(() => {
    const rows = entries.flatMap((entry) => entry.rows)
    const runnable = entries.filter((entry) => entry.surfaces.includes('terminal'))
    return [
      ...buildAgentPickerLaunchOptions(entries, commandOverrides),
      ...buildCustomAgentLaunchOptions(
        launchableCustomAgents(
          customAgents,
          runnable.map((entry) => entry.agent),
          rows
        ),
        rows
      )
    ]
  }, [entries, commandOverrides, customAgents])
  return hideAgents ? (
    <TabBarCreateEntry {...props} />
  ) : (
    <TabBarCreateEntry {...props} agentPickerEntries={entries} agentOptions={launchOptions} />
  )
}
