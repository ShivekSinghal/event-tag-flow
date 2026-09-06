-- Keep legacy game rows for audit history, but hide duplicate aliases from current POS sales when
-- their canonical Pinkredibles game exists. This is intentionally non-destructive and safe to
-- replay; historical transactions, staff assignments, and round records remain untouched.
UPDATE public.games AS legacy
SET available = false
WHERE lower(legacy.name) = 'hurdles'
  AND EXISTS (
    SELECT 1
    FROM public.games AS canonical
    WHERE lower(canonical.name) = 'hurdle'
      AND canonical.id <> legacy.id
  );

UPDATE public.games AS legacy
SET available = false
WHERE lower(legacy.name) = 'issue with the tissue'
  AND EXISTS (
    SELECT 1
    FROM public.games AS canonical
    WHERE lower(canonical.name) = 'issue with a tissue'
      AND canonical.id <> legacy.id
  );
