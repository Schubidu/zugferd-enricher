/**
 * Pinned FeRD 2.5.2 / Factur-X 1.09.2 validation resources, exclusively
 * served from the SAME origin as the already-loaded app.
 *
 * SHA-256 hashes are from the verified Mustangproject CLI 2.26.0 extraction.
 * No invoice payload is ever passed to fetch(). Missing/changed resources
 * fail closed. The PDF/A-3 export itself remains disabled.
 */
export const VALIDATOR_RESOURCES = {
  "FACTUR-X_EN16931.xsd":
    "34e51a9b26c95ef6e09297051b9921a05279a4024e659f236ba5d5e0f5a23bec",
  "FACTUR-X_EN16931_urn_un_unece_uncefact_data_standard_QualifiedDataType_100.xsd":
    "5a3ce756cfa8d4f2ff3165d68123cfb7fbf3c7b64664edb0de38cca64d5c413b",
  "FACTUR-X_EN16931_urn_un_unece_uncefact_data_standard_ReusableAggregateBusinessInformationEntity_100.xsd":
    "4a091d4339eddab30f6f5d29364ca2297607d72f03af7da2786637f08bdb3cf7",
  "FACTUR-X_EN16931_urn_un_unece_uncefact_data_standard_UnqualifiedDataType_100.xsd":
    "f87a1b78d2b7177955957002f8c2a7917e326038d38803f875266cc7579ea857",
  "EN16931-CII-validation.xslt":
    "b98ac4b99611b4fa332820e130f551805201a602d4f33173016f975ea904f192",
  "FACTUR-X_EN16931.xslt":
    "d412c035cd790e0ea0de36b59f58a868f4d1a28bc2072fc2204f23dbeb2850d7",
  "FACTUR-X_EN16931_codedb.xml":
    "dd3856984b69e25d5ba6312ec7c8f68e4458064a5998bebcfe8ae66de1a21cad",
} as const;

export type ValidatorResourceName = keyof typeof VALIDATOR_RESOURCES;
export type ValidatorResources = Map<ValidatorResourceName, Uint8Array>;

const MAX_RESOURCE_BYTES = 1_000_000;

async function sha256(value: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Browser SHA-256 unavailable");
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(value).buffer);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2,"0")).join("");
}

/** Fetches ONLY the seven packaged, verified app assets – never invoice data. */
export async function loadValidatorResources(): Promise<ValidatorResources> {
  const entries = Object.entries(VALIDATOR_RESOURCES) as
    Array<[ValidatorResourceName,string]>;
  const resources = await Promise.all(entries.map(async ([name,expected]) => {
    const url = new URL(
      import.meta.env.BASE_URL + "validation/ferd-2.5.2/" + name,
      self.location.href,
    );
    if (url.origin !== self.location.origin)
      throw new Error("External validation resource forbidden");
    const response = await fetch(url, {
      method:"GET",mode:"same-origin",credentials:"same-origin",
      redirect:"error",cache:"force-cache",
    });
    if (!response.ok) throw new Error("Missing validation resource: " + name);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RESOURCE_BYTES ||
      await sha256(bytes) !== expected) {
      throw new Error("Validation resource changed or unsupported: " + name);
    }
    return [name,bytes] as const;
  }));
  return new Map(entries.map(([name],i) => resources[i] ?? [name,new Uint8Array()]));
}
