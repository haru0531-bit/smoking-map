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
};

const DEFAULT_CENTER = { lat: 34.7024, lng: 135.4959 };

const SEARCH_KEYWORDS = [
  "喫煙所",
  "喫煙スペース",
  "喫煙ルーム",
  "指定喫煙場所",
  "公衆喫煙所",
  "smoking area",
];

export default function SmokingMap({ apiKey }: { apiKey: string }) {
  const [center, setCenter] = useState<{ lat: number; lng: number }>(DEFAULT_CENTER);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(true);
  const [locError, setLocError] = useState<string | null>(null);
  const [foundCount, setFoundCount] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);

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
            onSearchStateChange={(s) => setSearching(s)}
            onResultsChange={(n) => setFoundCount(n)}
          />
        </Map>
        <Header
          locating={locating}
          locError={locError}
          foundCount={foundCount}
          searching={searching}
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
}: {
  locating: boolean;
  locError: string | null;
  foundCount: number | null;
  searching: boolean;
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
      <strong>🚬 喫煙所マップ</strong>
      <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
        {locating
          ? "現在地を取得中…"
          : locError
          ? locError
          : searching
          ? "周辺を検索中…"
          : foundCount !== null
          ? `周辺で ${foundCount} 件の喫煙所が見つかったで（地図を動かすと再検索）`
          : "地図を動かすと、その周辺の喫煙所を検索するで"}
      </div>
    </div>
  );
}

function PlacesLoader({
  center,
  onSearchStateChange,
  onResultsChange,
}: {
  center: { lat: number; lng: number };
  onSearchStateChange: (searching: boolean) => void;
  onResultsChange: (count: number) => void;
}) {
  const map = useMap();
  const placesLib = useMapsLibrary("places");
  const [places, setPlaces] = useState<SmokingPlace[]>([]);
  const [selected, setSelected] = useState<SmokingPlace | null>(null);
  const lastSearchedRef = useRef<{ lat: number; lng: number } | null>(null);
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
          {
            query: keyword,
            location: loc,
            radius: 2000,
          },
          (results, status, pagination) => {
            if (status === "OK" && results) {
              all.push(...results);
            }
            pageCount++;
            if (pagination && pagination.hasNextPage && pageCount < 3) {
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

  const search = useCallback(
    async (loc: { lat: number; lng: number }) => {
      if (!placesLib || !map) return;
      const myToken = ++searchTokenRef.current;
      onSearchStateChange(true);

      const service = new placesLib.PlacesService(map);

      const allResults = await Promise.all(
        SEARCH_KEYWORDS.map((kw) => searchKeyword(service, kw, loc))
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
          if (types.some((t) => excludeTypes.includes(t)) && !/喫煙|smoking/i.test(name)) {
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
          });
        }
      }

      setPlaces(merged);
      onResultsChange(merged.length);
      onSearchStateChange(false);
    },
    [placesLib, map, searchKeyword, onSearchStateChange, onResultsChange]
  );

  useEffect(() => {
    if (!placesLib || !map) return;
    const last = lastSearchedRef.current;
    if (
      last &&
      Math.abs(last.lat - center.lat) < 0.005 &&
      Math.abs(last.lng - center.lng) < 0.005
    ) {
      return;
    }
    const t = setTimeout(() => {
      lastSearchedRef.current = center;
      search(center);
    }, 600);
    return () => clearTimeout(t);
  }, [center, placesLib, map, search]);

  return (
    <>
      {places.map((p) => (
        <AdvancedMarker
          key={p.id}
          position={p.position}
          onClick={() => setSelected(p)}
          title={p.name}
        >
          <div style={{ fontSize: 28 }}>🚬</div>
        </AdvancedMarker>
      ))}
      {selected && (
        <InfoWindow position={selected.position} onCloseClick={() => setSelected(null)}>
          <div style={{ maxWidth: 240 }}>
            <div style={{ fontWeight: "bold", marginBottom: 4 }}>{selected.name}</div>
            {selected.address && (
              <div style={{ fontSize: 12, color: "#555" }}>{selected.address}</div>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
}
