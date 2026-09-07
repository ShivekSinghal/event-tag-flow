import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function TagIdentifier({ tagId }: { tagId: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Show full tag ID"
          aria-label={`Show full tag ID ${tagId}`}
          className="inline-block max-w-full cursor-pointer font-mono underline decoration-dotted underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {tagId.length > 9 ? `...${tagId.slice(-6)}` : tagId}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 max-w-[calc(100vw-2rem)]">
        <p className="mb-2 text-sm font-semibold">Full tag ID</p>
        <code className="block select-all break-all text-sm">{tagId}</code>
      </PopoverContent>
    </Popover>
  );
}
