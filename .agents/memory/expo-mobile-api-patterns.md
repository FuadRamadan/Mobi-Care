---
name: Expo mobile API client patterns
description: Orval-generated hook call patterns for the @workspace/api-client-react client from a React Native / Expo context.
---

## Hook call signatures (Orval pattern)

React Query options are nested inside `{ query: UseQueryOptions }`, not spread flat:

```ts
// ✓ CORRECT — options wrapped in { query: ... }
usePatientListOrders({ query: { queryKey: getPatientListOrdersQueryKey(), refetchInterval: 15_000 } });

// ✗ WRONG — flat options object (second positional arg)
usePatientListOrders({}, { queryKey: ..., refetchInterval: ... });
```

For hooks with path params, the id is the first positional arg (string), not an object:

```ts
// ✓ CORRECT
usePatientGetOrder(id, { query: { queryKey: getPatientGetOrderQueryKey(id), enabled: !!id } });

// ✗ WRONG
usePatientGetOrder({ id }, { queryKey: getPatientGetOrderQueryKey({ id }) });
```

For hooks without params (no path/query params), there is NO first positional arg:

```ts
// ✓ CORRECT
usePatientListOrders({ query: { ... } });

// ✗ WRONG
usePatientListOrders({}, { ... });
```

## Mutation call patterns

Body-only mutations wrap the body in `{ data: Body }`:

```ts
createOrder.mutateAsync({ data: { pharmacyId, fulfillmentType, items, ... } });
uploadPrescription.mutateAsync({ data: { image: base64DataUrl } });
markPatientNotificationsRead.mutateAsync({ data: undefined }); // data is optional
```

Path-only mutations take `{ id: string }` directly:

```ts
payOrder.mutateAsync({ id: order.id });  // NO { data: ... } wrapper
```

**Why:** Orval generates mutations differently based on whether the variable is a path param vs. body. Path params → direct key on the mutate arg. Body → wrapped in `data`.

## setBaseUrl placement

Call `setBaseUrl(...)` at module level in `app/_layout.tsx` (outside any component/hook), importing from `@workspace/api-client-react`. This runs once when the bundle loads.

## setAuthTokenGetter placement

Call `setAuthTokenGetter(() => tokenRef.current)` inside `useEffect` in the AuthProvider. Use a ref so the getter always returns the latest token without re-registering.

## queryKey requirement

Pass `queryKey` inside `{ query: { queryKey: getXxxQueryKey(...) } }` whenever passing any react-query option. The helper `getXxxQueryKey(params?)` signature mirrors the main function's param signature.
