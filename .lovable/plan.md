## Goal

In the POS Food section, hardcode the menu pricing properly so totals and NFC charges work correctly, and make the Food Calculator always visible (no toggle).

## Changes

**File:** `src/pages/POS.tsx`

### 1. Fix price parsing in dish dropdown

Each `<SelectItem>` `value` currently encodes the price with a `₹` symbol (e.g. `"Manas' Curry Cut Biryani|₹550"`). The handler does `parseFloat(price)`, and `parseFloat("₹550")` returns `NaN`, so added items get a broken price and the calculator total / NFC charge are wrong.

Drop the `₹` from the `value` only — keep it in the visible label:

| Item                     | Old `value`                      | New `value`                     |
| ------------------------ | -------------------------------- | ------------------------------- |
| Manas' Curry Cut Biryani | `Manas' Curry Cut Biryani\|₹550` | `Manas' Curry Cut Biryani\|550` |
| Chicken 65               | `Chicken 65\|₹350`               | `Chicken 65\|350`               |
| Gobhi 65                 | `Gobhi 65\|₹250`                 | `Gobhi 65\|250`                 |
| Chicken Chettinad        | `Chicken Chettinad\|₹400`        | `Chicken Chettinad\|400`        |
| Veg Korma                | `Veg Korma\|₹300`                | `Veg Korma\|300`                |
| Parotta                  | `Parotta\|₹100`                  | `Parotta\|100`                  |

Items and prices match the screenshot exactly — no items added or removed.

### 2. Remove the "Show Calculator" toggle

Currently the Food section shows just an empty header until the user clicks "Show Calculator". Make the calculator always visible:

- Remove the toggle `<Button>` and the `showCalculator` conditional wrapper around the Food Calculator `<Card>`.
- Replace the toggle row with a simple section heading (Calculator icon + "Food Items").
- Leave the `showCalculator` state declaration in place (low risk; harmless if unused elsewhere).

## Out of scope

- Drinks prices — unchanged.
- Backend / DB — food sales are written into `transactions` at sale time using the price passed in. With the parseFloat fix, the correct numeric amount flows into Supabase automatically. There is no menu table to update.
- Permissions, NFC flow, custom games — unchanged.
