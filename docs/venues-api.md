# Venues API

Base route: `/venues`

## Create Venue

- Method: `POST`
- Path: `/venues`
- Auth: required (`requireAuth` middleware)

Creates a venue and links it to a city resolved by `city.placeId`.

- If city exists for `placeId`, it is reused.
- If city does not exist, a new city is created from the provided city payload.

### Request Body

```json
{
  "city": {
    "placeId": "google_place_id_123",
    "name": "Bengaluru",
    "state": "Karnataka",
    "country": "India",
    "latitude": 12.9716,
    "longitude": 77.5946
  },
  "venue": {
    "name": "Turf Arena HSR",
    "address": "HSR Layout, Bengaluru",
    "latitude": 12.9123,
    "longitude": 77.6445
  }
}
```

### Required Fields

- `city.placeId` (non-empty string)
- `city.name` (non-empty string)
- `city.state` (non-empty string)
- `city.country` (non-empty string)
- `city.latitude` (number in range `[-90, 90]`)
- `city.longitude` (number in range `[-180, 180]`)
- `venue.name` (non-empty string)

### Optional Venue Fields

- `venue.address`: string, `null`, or empty string (`""`)
- `venue.latitude`: number in range `[-90, 90]`, `null`, or empty string (`""`)
- `venue.longitude`: number in range `[-180, 180]`, `null`, or empty string (`""`)

### Success Responses

- `201 Created`

```json
{
  "message": "Venue created successfully",
  "data": {
    "id": "4ad8f6df-5f94-4506-8266-63ecf49ecdb2",
    "name": "Turf Arena HSR",
    "cityId": "b4a1f7ff-6cc6-4f40-863e-7a7f4c4ea4d5",
    "address": "HSR Layout, Bengaluru",
    "latitude": 12.9123,
    "longitude": 77.6445,
    "createdAt": "2026-05-01T11:29:58.543Z",
    "updatedAt": "2026-05-01T11:29:58.543Z",
    "city": {
      "id": "b4a1f7ff-6cc6-4f40-863e-7a7f4c4ea4d5",
      "name": "Bengaluru",
      "state": "Karnataka",
      "country": "India",
      "placeId": "google_place_id_123",
      "latitude": 12.9716,
      "longitude": 77.5946,
      "createdAt": "2026-05-01T11:29:58.120Z",
      "updatedAt": "2026-05-01T11:29:58.120Z"
    }
  }
}
```

### Error Responses

- `400 Bad Request`
  - `"name is required"`
  - `"city details are required"`
  - `"city.placeId is required"`
  - `"city.name is required"`
  - `"city.state is required"`
  - `"city.country is required"`
  - `"city.latitude is required and must be a valid number"`
  - `"city.longitude is required and must be a valid number"`
  - `"address must be a string or null"`
  - `"latitude must be between -90 and 90"`
  - `"latitude must be a number or null"`
  - `"longitude must be between -180 and 180"`
  - `"longitude must be a number or null"`
  - `"City not found for the resolved placeId"` (defensive FK error case)
- `500 Internal Server Error`
  - `"Failed to create venue"`

## Search Venues

- Method: `GET`
- Path: `/venues/search`
- Auth: not required
- Query param: `q` (optional string)

If `q` is provided, results are filtered by:

- venue `name`
- venue `address`
- city `name`
- city `state`
- city `country`

Results include city details and are sorted by city name, then venue name.

### Search Response

- `200 OK`

```json
{
  "message": "Venues fetched successfully",
  "data": []
}
```
