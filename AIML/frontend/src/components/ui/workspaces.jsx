'use client';

import * as React from 'react';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '../../components/ui/avatar.jsx';
import { cn } from '../../lib/utils.js';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '../../components/ui/popover.jsx';

const WorkspaceContext = React.createContext(null);

function useWorkspaceContext() {
	const context = React.useContext(WorkspaceContext);
	if (!context) {
		throw new Error(
			'Workspace components must be used within WorkspaceProvider',
		);
	}
	return context;
}

function WorkspaceProvider({
	children,
	workspaces,
	selectedWorkspaceId,
	onWorkspaceChange,
	open: controlledOpen,
	onOpenChange,
	getWorkspaceId = (workspace) => workspace.id,
	getWorkspaceName = (workspace) => workspace.name,
}) {
	const [internalOpen, setInternalOpen] = React.useState(false);

	const open = controlledOpen ?? internalOpen;
	const setOpen = onOpenChange ?? setInternalOpen;

	const selectedWorkspace = React.useMemo(() => {
		if (!selectedWorkspaceId) return workspaces[0];
		return (
			workspaces.find((ws) => getWorkspaceId(ws) === selectedWorkspaceId) ||
			workspaces[0]
		);
	}, [workspaces, selectedWorkspaceId, getWorkspaceId]);

	const handleWorkspaceSelect = React.useCallback(
		(workspace) => {
			onWorkspaceChange?.(workspace);
			setOpen(false);
		},
		[onWorkspaceChange, setOpen],
	);

	const value = {
		open,
		setOpen,
		selectedWorkspace,
		workspaces,
		onWorkspaceSelect: handleWorkspaceSelect,
		getWorkspaceId,
		getWorkspaceName,
	};

	return (
		<WorkspaceContext.Provider value={value}>
			<Popover open={open} onOpenChange={setOpen}>
				{children}
			</Popover>
		</WorkspaceContext.Provider>
	);
}

function WorkspaceTrigger({
	className,
	renderTrigger,
	...props
}) {
	const { open, selectedWorkspace, getWorkspaceName } = useWorkspaceContext();

	if (!selectedWorkspace) return null;

	if (renderTrigger) {
		return (
			<PopoverTrigger asChild>
				<button className={className} {...props}>
					{renderTrigger(selectedWorkspace, open)}
				</button>
			</PopoverTrigger>
		);
	}

	return (
		<PopoverTrigger asChild>
			<button
				data-state={open ? 'open' : 'closed'}
				className={cn(
					'border-input bg-background ring-offset-background flex h-12 w-full max-w-72 items-center justify-between rounded-md border px-3 py-2 text-sm',
					'placeholder:text-muted-foreground focus:ring-ring focus:ring-2 focus:ring-offset-2 focus:outline-none',
					'disabled:cursor-not-allowed disabled:opacity-50',
					'hover:bg-accent hover:text-accent-foreground',
					className,
				)}
				{...props}
			>
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<Avatar className="h-6 w-6">
						<AvatarImage
							src={selectedWorkspace.logo}
							alt={getWorkspaceName(selectedWorkspace)}
						/>
						<AvatarFallback className="text-xs">
							{getWorkspaceName(selectedWorkspace).charAt(0).toUpperCase()}
						</AvatarFallback>
					</Avatar>
					<span className="truncate font-medium">
						{getWorkspaceName(selectedWorkspace)}
					</span>
				</div>
				<ChevronsUpDownIcon className="h-4 w-4 shrink-0 opacity-50" />
			</button>
		</PopoverTrigger>
	);
}

function WorkspaceContent({
	className,
	children,
	renderWorkspace,
	title = 'Workspaces',
	searchable = false,
	onSearch,
	...props
}) {
	const {
		workspaces,
		selectedWorkspace,
		onWorkspaceSelect,
		getWorkspaceId,
		getWorkspaceName,
	} = useWorkspaceContext();

	const [searchQuery, setSearchQuery] = React.useState('');

	const filteredWorkspaces = React.useMemo(() => {
		if (!searchQuery) return workspaces;
		return workspaces.filter((ws) =>
			getWorkspaceName(ws).toLowerCase().includes(searchQuery.toLowerCase()),
		);
	}, [workspaces, searchQuery, getWorkspaceName]);

	React.useEffect(() => {
		onSearch?.(searchQuery);
	}, [searchQuery, onSearch]);

	const defaultRenderWorkspace = (
		workspace,
		isSelected,
	) => (
		<div className="flex min-w-0 flex-1 items-center gap-2">
			<Avatar className="h-6 w-6">
				<AvatarImage
					src={workspace.logo}
					alt={getWorkspaceName(workspace)}
				/>
				<AvatarFallback className="text-xs">
					{getWorkspaceName(workspace).charAt(0).toUpperCase()}
				</AvatarFallback>
			</Avatar>
			<div className="flex min-w-0 flex-1 flex-col items-start">
				<span className="truncate text-sm font-medium">{getWorkspaceName(workspace)}</span>
				{workspace.plan && (
					<span className="text-muted-foreground text-[10px] uppercase tracking-wider">
						{workspace.plan}
					</span>
				)}
			</div>
			{isSelected && <CheckIcon className="ml-auto h-4 w-4 text-primary" />}
		</div>
	);

	return (
		<PopoverContent
			className={cn('p-0 w-72 overflow-hidden shadow-2xl', className)}
			align={props.align || 'start'}
			{...props}
		>
			<div className="bg-muted/50 border-b px-3 py-2">
				<p className="text-muted-foreground text-[10px] font-bold uppercase tracking-[0.2em]">{title}</p>
			</div>

			{searchable && (
				<div className="border-b px-3 py-2">
					<input
						type="text"
						placeholder="Search workspaces..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="placeholder:text-muted-foreground w-full border-none bg-transparent text-sm outline-none"
					/>
				</div>
			)}

			<div className="max-h-[300px] overflow-y-auto">
				{filteredWorkspaces.length === 0 ? (
					<div className="text-muted-foreground px-3 py-8 text-center text-sm">
						No workspaces found
					</div>
				) : (
					<div className="p-1 space-y-1">
						{filteredWorkspaces.map((workspace) => {
							const isSelected =
								selectedWorkspace &&
								getWorkspaceId(selectedWorkspace) === getWorkspaceId(workspace);

							return (
								<button
									key={getWorkspaceId(workspace)}
									onClick={() => onWorkspaceSelect(workspace)}
									className={cn(
										'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors',
										'hover:bg-accent hover:text-accent-foreground',
										'focus:outline-none focus:bg-accent',
										isSelected && 'bg-accent/50 text-accent-foreground',
									)}
								>
									{renderWorkspace
										? renderWorkspace(workspace, !!isSelected)
										: defaultRenderWorkspace(workspace, !!isSelected)}
								</button>
							);
						})}
					</div>
				)}
			</div>

			{children && (
				<div className="bg-muted/30 border-t p-1">
					{children}
				</div>
			)}
		</PopoverContent>
	);
}

export { WorkspaceProvider as Workspaces, WorkspaceTrigger, WorkspaceContent };
