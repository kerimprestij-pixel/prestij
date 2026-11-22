// What the checkout form gets for a signed-in customer (pure types; built by loadCheckoutAccount in
// src/lib/account/checkout.ts). Values use the checkout's flat field names ("shippingAddress.city").

export type CheckoutSavedAddress = {
  id: number;
  title: string;
  /** "Ayşe Yılmaz · Kocasinan / Kayseri" */
  summary: string;
  /** Flat checkout field values for this address (delivery, phone and its invoice data). */
  values: Record<string, string>;
};

export type CheckoutAccount = {
  /** The account e-mail (the order is sent there; the field is read-only). */
  email: string;
  addresses: CheckoutSavedAddress[];
  /** The address picked at first (default delivery address), or null for "new address". */
  defaultAddressId: number | null;
  /** Values for a new address: the account e-mail and phone only. */
  blankValues: Record<string, string>;
  /** Tick "Bu adresi kaydet" by default (the customer has no saved address yet). */
  saveByDefault: boolean;
  labels: {
    signedInAs: string;
    emailLocked: string;
    savedAddresses: string;
    newAddress: string;
    saveAddress: string;
    saveAddressHint: string;
  };
};

/** Sign-in prompt for guests above the contact fields. */
export type CheckoutGuestPrompt = { text: string; linkLabel: string; href: string };

/** Name of the "Bu adresi kaydet" checkbox in the checkout form (read by placeOrderAction). */
export const SAVE_ADDRESS_FIELD = "account.saveAddress";
