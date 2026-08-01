# v30: Quick-Add Feature

## Overview

The Quick-Add feature makes it faster and easier to log spending without navigating through multiple screens. Each category now has a **+** button that opens the Add tab with that category pre-selected.

## How It Works

### Before v30
1. Scroll down and tap the large **+** button at the bottom
2. Add tab opens with no category selected
3. Select a category from the 25 options (3x grid)
4. Enter amount, note, date
5. Tap "Add"

**Total taps: 5-6** ⏱️

### After v30
1. In the spending list, tap the **+** button next to any category
2. Add tab opens with that category already selected
3. Enter amount (field auto-focused)
4. Tap "Add"

**Total taps: 3** 🚀

## Visual Design

### The + Button
- **Position**: Right side of each category row
- **Color**: Matches the category color (inheritance)
- **Size**: 32x32 pixels, rounded square (8px border radius)
- **Icon**: White + symbol (font-size: 18px, lighter weight)
- **Hover**: Scales up slightly (1.08x) for tactile feedback
- **Tooltip**: "Quick add to [Category Name]"

### Example
```
[Category Icon] Groceries                    $420.50 / $500  [+]
[Category Icon] Restaurant & takeout         $180.00 / $500  [+]
[Category Icon] Coffee                       $35.24 / $150   [+]
```

### Color Integration
- Each category has its own distinct color
- The + button inherits that color
- Creates visual consistency without needing to memorize category positions

## User Flow

### Quick Add Flow
```
User taps + on "Groceries"
        ↓
Add tab opens
category = "Groceries" (pre-selected)
        ↓
Amount field auto-focused, ready for input
User types: 42.50
        ↓
User taps "Add $42.50 to Groceries"
        ↓
Transaction saved
quickAddCat cleared
Tab switches back to Home
```

### Escaping Quick Add
User can:
- Tap the back/home button → quickAddCat cleared
- Tap history button → quickAddCat cleared
- Tap upload button → quickAddCat cleared
- Tap bills button → quickAddCat cleared

No data is lost; just returns to home without saving.

## Implementation Details

### State Management
```javascript
const [quickAddCat, setQuickAddCat] = useState(null);
// null = no quick add active
// 'groceries' = quick add for groceries category
```

### Event Handling
```javascript
// + button click
onClick={e => {
  e.stopPropagation();  // Don't expand/collapse the category
  setQuickAddCat(cat.id);  // Pre-select this category
  setTab('add');  // Open add tab
}}
```

### AddTab Integration
```javascript
export function AddTab({profile, allCats, onAdd, quickCat}) {
  const [cat, setCat] = useState(quickCat || null);  // Use quickCat if provided
  
  // Sync with prop changes
  useEffect(() => {
    if(quickCat) setCat(quickCat);
  }, [quickCat]);
}
```

### Cleanup
After adding transaction:
```javascript
onAdd: async tx => {
  await addTxn(tx);
  setQuickAddCat(null);  // Clear quick add state
  setTab('home');  // Return to home
}
```

## Benefits

### 1. **Speed**
- 50% fewer taps (3 vs 6)
- No category selection grid
- Auto-focused amount field
- Immediate context

### 2. **Accuracy**
- Pre-selected category reduces errors
- No need to remember category positions
- Visual confirmation with category color

### 3. **Flow**
- Keeps you in the context of the spending category
- No cognitive load of finding the category
- Natural progression: see category → add to it

### 4. **Discovery**
- Users naturally notice the + buttons
- More inviting than large button at bottom
- Encourages micro-transactions ("add that coffee right now")

## Edge Cases

### Multiple Rapid Additions
```javascript
// Scenario: User adds 3 items to Groceries
1. Taps + on Groceries
2. Enters $15, taps Add
3. Immediately taps + on Groceries again
   → Takes them back to Groceries with amount cleared
```
✅ Works as expected

### Switching Categories Mid-Entry
```javascript
// Scenario: User starts adding to Groceries, changes mind
1. Taps + on Groceries
2. Amount field focused
3. Taps + on Restaurant instead
   → AddTab re-renders
   → quickCat prop changes
   → category updates to Restaurant
```
✅ Works via useEffect hook

### Adding Without Switching Tabs
```javascript
// Scenario: Large + button still works
1. User taps bottom + button
2. quickAddCat is null
3. AddTab opens with no category selected
```
✅ Large button still works (backward compatible)

## Performance

- **No new network calls** — just local state
- **No re-renders** — quick add is UI-only until tab switch
- **No bundled size increase** — just a button + state
- **Animation smooth** — hardware-accelerated CSS transition

## Browser Support

✅ All modern browsers (iOS Safari, Android Chrome, desktop)
- Uses `e.stopPropagation()` (widely supported)
- Uses standard React hooks
- CSS scale transform is smooth on all devices

## Testing Checklist

- [x] Quick add button visible on all categories
- [x] Clicking + button opens Add tab
- [x] Category is pre-selected in AddTab
- [x] Amount field is auto-focused
- [x] Can submit and transaction appears
- [x] quickAddCat is cleared after adding
- [x] Clicking another category's + button updates selection
- [x] Navigating away from Add clears quickAddCat
- [x] Large + button at bottom still works (no category pre-selected)
- [x] + button color matches category color
- [x] + button scales on hover
- [x] Doesn't interfere with expand/collapse

## Future Enhancements

Possible additions:
- [ ] Hold to repeat last amount (gesture UX)
- [ ] Swipe from category to quick add (navigation)
- [ ] Favorites/recent amounts per category
- [ ] Quick add keyboard shortcut (desktop)
- [ ] Recent categories carousel at top
- [ ] "Add another" shortcut after submission
- [ ] Voice input ("Hey, add twenty to groceries")

## Related Features

- **Large + button**: For when user hasn't decided on category yet
- **Add Tab**: Main entry point for manual transactions
- **Partner notifications**: See when partner uses quick add
- **Quick notes**: Add contextual detail to transaction

---

## Commit History

- **v30**: Quick-add feature launch
- **v29**: Enhanced notifications (prep work)
- **v28**: Bill payment tracking
- **v27-v26**: Foundation features
