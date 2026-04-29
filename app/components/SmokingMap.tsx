"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  InfoWindow,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";

type SmokingPlace = {
  id: string;
  name: string;
  address?: string;
  position: { lat: number; lng: number };
  source: "keyword" | "review";
  reviewSnippet?: string;
};

const DEFAULT_CENTER = { lat: 34.7024, lng: 135.4959 };

const KEYWORDS_PUBLIC = [
  "喫煙所",
  "喫煙スペース",
  "喫煙ルーム",
  "指定喫煙場所",
  "公衆喫煙所",
  "屋外喫煙所",
  "smoking area",
  "smoking room",
  "シガーバー",
  "葉巻",
];

const KEYWORDS_VENUE = ["喫煙可 カフェ", "喫煙可 居酒屋", "分煙 カフェ", "シーシャ"];

const REVIEW_POSITIVE_RE =
  /(喫煙可|喫煙OK|喫煙ＯＫ|喫煙席|分煙|タバコ.{0,3}(吸え|可)|たばこ.{0,3}(吸え|可)|喫煙ルーム|喫煙スペース|加熱式.{0,4}可|シーシャ|シガー)/i;

const REVIEW_NEGATIVE_RE = /(全席禁煙|完全禁煙|終日禁煙|禁煙のみ)/;

export default function SmokingMap({ apiKey }: { apiKey: string }) {
  const [center, setCenter] = useState<{ lat: number; lng: number }>(DEFAULT_CENTER);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(true);
  const [locError, setLocError] = useState<string | null>(null);
  const [foundCount, setFoundCount] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [reviewSearchEnabled, setReviewSearchEnabled] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocError("このブラウザは位置情報に対応してへんわ");
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserPos(p);
        setCenter(p);
        setLocating(false);
      },
      (err) => {
        setLocError(`位置情報取得失敗：${err.message}（デフォルト位置を表示）`);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  return (
    <APIProvider apiKey={apiKey}>
      <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
        <Map
          mapId="smoking-map"
          defaultCenter={DEFAULT_CENTER}
          center={center}
          defaultZoom={16}
          gestureHandling="greedy"
          disableDefaultUI={false}
          onCameraChanged={(e) => setCenter(e.detail.center)}
          style={{ width: "100%", height: "100%" }}
        >
          {userPos && (
            <AdvancedMarker position={userPos} title="現在地">
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: "#1a73e8",
                  border: "3px solid white",
                  boxShadow: "0 0 0 2px #1a73e8",
                }}
              />
            </AdvancedMarker>
          )}
          <PlacesLoader
            center={center}
            reviewSearchEnabled={reviewSearchEnabled}
            onSearchStateChange={setSearching}
            onResultsChange={setFoundCount}
          />
        </Map>
        <Header
          locating={locating}
          locError={locError}
          foundCount={foundCount}
          searching={searching}
          reviewSearchEnabled={reviewSearchEnabled}
          onToggleReview={() => setReviewSearchEnabled((v) => !v)}
        />
      </div>
    </APIProvider>
  );
}

function Header({
  locating,
  locError,
  foundCount,
  searching,
  reviewSearchEnabled,
  onToggleReview,
}: {
  locating: boolean;
  locError: string | null;
  foundCount: number | null;
  searching: boolean;
  reviewSearchEnabled: boolean;
  onToggleReview: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        right: 12,
        background: "rgba(255,255,255,0.95)",
        padding: "10px 14px",
        borderRadius: 8,
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        fontSize: 14,
        zIndex: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>🚬 喫煙所マップ</strong>
        <label style={{ fontSize: 12, cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={reviewSearchEnabled}
            onChange={onToggleReview}
            style={{ marginRight: 4 }}
          />
          口コミからも検索（時間かかる）
        </label>
      </div>
      <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
        {locating
          ? "現在地を取得中…"
          : locError
          ? locError
          : searching
          ? "周辺を検索中…"
          : foundCount !== null
          ? `周辺で ${foundCount} 件見つかったで（🚬=喫煙所 / ☕=口コミから検出）`
          : "地図を動かすと、その周辺の喫煙所を検索するで"}
      </div>
    </div>
  );
}

function PlacesLoader({
  center,
  reviewSearchEnabled,
  onSearchStateChange,
  onResultsChange,
}: {
  center: { lat: number; lng: number };
  reviewSearchEnabled: boolean;
  onSearchStateChange: (searching: boolean) => void;
  onResultsChange: (count: number) => void;
}) {
  const map = useMap();
  const placesLib = useMapsLibrary("places");
  const [places, setPlaces] = useState<SmokingPlace[]>([]);
  const [selected, setSelected] = useState<SmokingPlace | null>(null);
  const lastSearchedRef = useRef<{
    lat: number;
    lng: number;
    review: boolean;
  } | null>(null);
  const searchTokenRef = useRef(0);

  const searchKeyword = useCallback(
    (
      service: google.maps.places.PlacesService,
      keyword: string,
      loc: { lat: number; lng: number }
    ): Promise<google.maps.places.PlaceResult[]> => {
      return new Promise((resolve) => {
        const all: google.maps.places.PlaceResult[] = [];
        let pageCount = 0;
        service.textSearch(
          { query: keyword, location: loc, radius: 2000 },
          (results, status, pagination) => {
            if (status === "OK" && results) all.push(...results);
            pageCount++;
            if (pagination && pagination.hasNextPage && pageCount < 2) {
              setTimeout(() => pagination.nextPage(), 1500);
            } else {
              resolve(all);
            }
          }
        );
      });
    },
    []
  );

  const nearbyVenues = useCallback(
    (
      service: google.maps.places.PlacesService,
      loc: { lat: number; lng: number },
      type: string
    ): Promise<google.maps.places.PlaceResult[]> => {
      return new Promise((resolve) => {
        service.nearbySearch(
          { location: loc, radius: 1000, type },
          (results, status) => {
            if (status === "OK" && results) resolve(results);
            else resolve([]);
          }
        );
      });
    },
    []
  );

  const checkReviewsForSmoking = useCallback(
    (
      service: google.maps.places.PlacesService,
      placeId: string
    ): Promise<{ ok: boolean; snippet?: string }> => {
      return new Promise((resolve) => {
        service.getDetails(
          {
            placeId,
            fields: ["reviews"],
          },
          (place, status) => {
            if (status !== "OK" || !place) {
              resolve({ ok: false });
              return;
            }
            const reviews = place.reviews || [];
            for (const rv of reviews) {
              const text = rv.text || "";
              if (REVIEW_NEGATIVE_RE.test(text)) continue;
              const m = text.match(REVIEW_POSITIVE_RE);
              if (m) {
                const idx = text.indexOf(m[0]);
                const snippet = text.slice(Math.max(0, idx - 30), idx + m[0].length + 60);
                resolve({ ok: true, snippet });
                return;
              }
            }
            resolve({ ok: false });
          }
        );
      });
    },
    []
  );

  const search = useCallback(
    async (loc: { lat: number; lng: number }) => {
      if (!placesLib || !map) return;
      const myToken = ++searchTokenRef.current;
      onSearchStateChange(true);

      const service = new placesLib.PlacesService(map);

      const allKeywords = [...KEYWORDS_PUBLIC, ...KEYWORDS_VENUE];
      const allResults = await Promise.all(
        allKeywords.map((kw) => searchKeyword(service, kw, loc))
      );
      if (myToken !== searchTokenRef.current) return;

      const seen = new Set<string>();
      const merged: SmokingPlace[] = [];
      for (const results of allResults) {
        for (const r of results) {
          if (!r.place_id || !r.geometry?.location) continue;
          if (seen.has(r.place_id)) continue;
          seen.add(r.place_id);
          const name = r.name || "";
          const types = r.types || [];
          const excludeTypes = ["transit_station", "airport", "subway_station", "train_station"];
          if (
            types.some((t) => excludeTypes.includes(t)) &&
            !/喫煙|smoking/i.test(name)
          ) {
            continue;
          }
          merged.push({
            id: r.place_id,
            name: name || "(名称不明)",
            address: r.formatted_address,
            position: {
              lat: r.geometry.location.lat(),
              lng: r.geometry.location.lng(),
            },
            source: "keyword",
          });
        }
      }

      setPlaces([...merged]);
      onResultsChange(merged.length);

      if (reviewSearchEnabled) {
        const venueTypes = ["cafe", "restaurant", "bar"];
        const venueResults = await Promise.all(
          venueTypes.map((t) => nearbyVenues(service, loc, t))
        );
        if (myToken !== searchTokenRef.current) return;

        const candidates: google.maps.places.PlaceResult[] = [];
        for (const list of venueResults) {
          for (const r of list) {
            if (!r.place_id || seen.has(r.place_id)) continue;
            seen.add(r.place_id);
            candidates.push(r);
          }
        }

        const limited = candidates.slice(0, 30);

        const batchSize = 5;
        for (let i = 0; i < limited.length; i += batchSize) {
          const batch = limited.slice(i, i + batchSize);
          const checks = await Promise.all(
            batch.map((c) => checkReviewsForSmoking(service, c.place_id!))
          );
          if (myToken !== searchTokenRef.current) return;

          for (let j = 0; j < checks.length; j++) {
            const result = checks[j];
            const original = batch[j];
            if (result.ok && original.geometry?.location) {
              merged.push({
                id: original.place_id!,
                name: original.name || "(名称不明)",
                address: original.vicinity,
                position: {
                  lat: original.geometry.location.lat(),
                  lng: original.geometry.location.lng(),
                },
                source: "review",
                reviewSnippet: result.snippet,
              });
            }
          }
          setPlaces([...merged]);
          onResultsChange(merged.length);
        }
      }

      onSearchStateChange(false);
    },
    [
      placesLib,
      map,
      searchKeyword,
      nearbyVenues,
      checkReviewsForSmoking,
      reviewSearchEnabled,
      onSearchStateChange,
      onResultsChange,
    ]
  );

  useEffect(() => {
    if (!placesLib || !map) return;
    const last = lastSearchedRef.current;
    if (
      last &&
      last.review === reviewSearchEnabled &&
      Math.abs(last.lat - center.lat) < 0.005 &&
      Math.abs(last.lng - center.lng) < 0.005
    ) {
      return;
    }
    const t = setTimeout(() => {
      lastSearchedRef.current = { ...center, review: reviewSearchEnabled };
      search(center);
    }, 600);
    return () => clearTimeout(t);
  }, [center, placesLib, map, search, reviewSearchEnabled]);

  return (
    <>
      {places.map((p) => (
        <AdvancedMarker
          key={p.id}
          position={p.position}
          onClick={() => setSelected(p)}
          title={p.name}
        >
          <div style={{ fontSize: 28 }}>{p.source === "review" ? "☕" : "🚬"}</div>
        </AdvancedMarker>
      ))}
      {selected && (
        <InfoWindow position={selected.position} onCloseClick={() => setSelected(null)}>
          <div style={{ maxWidth: 260 }}>
            <div style={{ fontWeight: "bold", marginBottom: 4 }}>
              {selected.source === "review" ? "☕ " : "🚬 "}
              {selected.name}
            </div>
            {selected.address && (
              <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>
                {selected.address}
              </div>
            )}
            {selected.reviewSnippet && (
              <div
                style={{
                  fontSize: 11,
                  color: "#333",
                  background: "#fff8e1",
                  padding: 6,
                  borderRadius: 4,
                  marginTop: 4,
                }}
              >
                <div style={{ fontWeight: "bold", marginBottom: 2 }}>口コミより：</div>
                「…{selected.reviewSnippet}…」
              </div>
            )}
            <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
              ※情報は参考まで。実際の喫煙可否はお店に確認してな
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
}
