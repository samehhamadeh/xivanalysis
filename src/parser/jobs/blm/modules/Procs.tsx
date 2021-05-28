import {Plural, Trans} from '@lingui/react'
import {ActionLink, StatusLink} from 'components/ui/DbLink'
import {Event, Events} from 'event'
import {CastEvent} from 'fflogs'
import _ from 'lodash'
import {filter} from 'parser/core/filter'
import {dependency} from 'parser/core/Injectable'
import CastTime from 'parser/core/modules/CastTime'
import {ProcGroup, Procs as CoreProcs} from 'parser/core/modules/Procs'
import {SEVERITY, Suggestion} from 'parser/core/modules/Suggestions'
import React from 'react'

declare module 'event' {
	interface FieldsTargeted {
		overrideAction?: number
	}
}

declare module 'fflogs' {
	interface Ability {
		overrideAction?: number
	}
}

export default class Procs extends CoreProcs {
	@dependency castTime!: CastTime

	trackedProcs = [
		{
			procStatus: this.data.statuses.THUNDERCLOUD,
			consumeActions: [
				this.data.actions.THUNDER_III,
				this.data.actions.THUNDER_IV,
			],
		},
		{
			procStatus: this.data.statuses.FIRESTARTER,
			consumeActions: [this.data.actions.FIRE_III],
		},
	]

	private actionProcs: Map<number, number> = new Map([
		[this.data.actions.THUNDER_III.id, this.data.actions.THUNDER_III_PROC.id],
		[this.data.actions.THUNDER_IV.id, this.data.actions.THUNDER_IV_PROC.id],
		[this.data.actions.FIRE_III.id, this.data.actions.FIRE_III_PROC.id],
	])

	private hasSharpcast: boolean = false

	initialise() {
		super.initialise()

		// Hacky workaround because Statuses aren't in Analyser format yet, can (and probably should) remove this when that's done
		const trackedStatusFilter = filter<Event>()
			.target(this.parser.actor.id)
			.status(this.data.statuses.SHARPCAST.id)
		this.addEventHook(trackedStatusFilter.type('statusApply'), () => { this.hasSharpcast = true })
		this.addEventHook(trackedStatusFilter.type('statusRemove'), () => { this.hasSharpcast = false })
	}

	/**
	 * Legacy API to check to see if a proc was active for this event. Only for use in Modules until they can be converted to Analyser
	 * @deprecated */
	public checkProcLegacy(event: CastEvent, statusId: number) : boolean {
		return this.checkProcAtTimestamp(this.parser.fflogsToEpoch(event.timestamp), statusId)
	}
	/** Check to see if a proc was active for this event */
	public checkProc(event: Event, statusId: number): boolean {
		return this.checkProcAtTimestamp(event.timestamp, statusId)
	}
	/** Check to see if a proc was active at this timestamp */
	private checkProcAtTimestamp(timestamp: number, statusId: number) : boolean {
		const procHistory = this.getHistoryForStatus(statusId)
		if (procHistory.length === 0) { return false }

		const lastHistoryEntry = _.last(procHistory)?.stop || 0
		return timestamp === lastHistoryEntry
	}

	protected jobSpecificCheckConsumeProc(_procGroup: ProcGroup, event: Events['action']): boolean {
		// If we were already hardcasting this spell, it does not consume the proc
		return !(this.lastCastingSpellId && this.lastCastingSpellId === event.action)
	}

	protected jobSpecificOnConsumeProc(procGroup: ProcGroup, event: Events['action']): void {
		// BLM's procs are all instant-casts
		this.castTime.set([event.action], 0, event.timestamp, event.timestamp)

		const actionProcId = this.actionProcs.get(event.action)
		if (actionProcId) {
			event.overrideAction = actionProcId
		}
		// Thunder procs used while sharpcast is up re-grant the proc status without technically removing it, so we need to forcibly add the 'removal' here to keep the 'dropped' counting correct
		if ((event.action === this.data.actions.THUNDER_III.id || event.action === this.data.actions.THUNDER_IV.id) && this.hasSharpcast) {
			this.tryAddEventToRemovals(procGroup, event)
		}
		return
	}

	protected addJobSpecificSuggestions(): void {
		const droppedThunderClouds: number = this.getDropCountForStatus(this.data.statuses.THUNDERCLOUD.id)
		if (droppedThunderClouds > 0) {
			this.suggestions.add(new Suggestion({
				icon: this.data.actions.THUNDER_III_PROC.icon,
				content: <Trans id="blm.procs.suggestions.dropped-t3ps.content">
					You lost at least one <ActionLink {...this.data.actions.THUNDER_III}/> proc by allowing <StatusLink {...this.data.statuses.THUNDERCLOUD}/> to expire without using it.
				</Trans>,
				severity: SEVERITY.MEDIUM,
				why: <Trans id="blm.procs.suggestions.dropped-t3ps.why">
					<Plural value={droppedThunderClouds} one="# Thundercloud proc" other="# Thundercloud procs" /> expired.
				</Trans>,
			}))
		}

		const droppedFireStarters: number = this.getDropCountForStatus(this.data.statuses.FIRESTARTER.id)
		if (droppedFireStarters > 0) {
			this.suggestions.add(new Suggestion({
				icon: this.data.actions.FIRE_III_PROC.icon,
				content: <Trans id="blm.procs.suggestions.dropped-f3ps.content">
					You lost at least  one <ActionLink {...this.data.actions.FIRE_III}/> proc by allowing <StatusLink {...this.data.statuses.FIRESTARTER}/> to expire without using it.
				</Trans>,
				severity: SEVERITY.MEDIUM,
				why: <Trans id="blm.procs.suggestions.dropped-f3ps.why">
					<Plural value={droppedFireStarters} one="# Firestarter proc" other="# Firestarter procs" /> expired.
				</Trans>,
			}))
		}
	}
}