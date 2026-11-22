import { ReactiveStore } from "@luna/core";
import { redux } from "@luna/lib";
import { LunaNumberSetting, LunaSettings, LunaSwitchSetting, LunaTextSetting } from "@luna/ui";
import React from "react";

import { live } from "./live";
import { setAllowedAddresses, setDeviceName } from "./receiver.native";

export const settings = await ReactiveStore.getPluginStorage("DesktopConnectNative", {
	// Empty: "TidaLuna: <computer name>"
	deviceName: "",
	firstPort: 9000,
	// Besides the home network, the computer and Tailscale: addresses and ranges, "203.0.113.5, 198.51.100.0/24"
	allowedAddresses: "",
	allowAnyAddress: false,
	// Besides the account signed in here: TIDAL user ids, "123456, 234567"
	otherAccounts: "",
	anyAccount: false,
});

// The TIDAL account signed in to this TIDAL ("" when none)
export const computerAccount = () => {
	const userId = redux.store.getState().session?.userId;
	return userId ? String(userId) : "";
};
// User ids are numbers: "0123" is 123
const accountKey = (id: string) => id.trim().replace(/^0+(?=\d)/, "");
// Whether a phone of this TIDAL account may use the receiver: the account signed in here (also after a sign-in or out)
// and the ones in the settings, read when the phone connects
export const isAllowedAccount = (userId: string) => {
	if (settings.anyAccount) return true;
	const allowed = [computerAccount(), ...settings.otherAccounts.split(/[\s,;]+/)].filter((id) => /^\d+$/.test(id)).map(accountKey);
	const key = accountKey(userId);
	return key !== "0" && allowed.includes(key);
};

// Applied once typing stops, not on every key
const applyAfterMs = 1000;
const debounced = () => {
	let timer: number | undefined;
	return (apply: () => void) => {
		clearTimeout(timer);
		timer = window.setTimeout(apply, applyAfterMs);
	};
};
const afterNameTyped = debounced();
const afterAddressesTyped = debounced();

const allowedAddressesDesc =
	"Who else may connect besides the home network, this computer and Tailscale: addresses or ranges, like 203.0.113.5, 198.51.100.0/24. " +
	"Only add the networks you need (a port forwarded from the internet)";

export const Settings = () => {
	const [deviceName, setName] = React.useState(settings.deviceName);
	const [firstPort, setFirstPort] = React.useState(settings.firstPort);
	const [allowedAddresses, setAddresses] = React.useState(settings.allowedAddresses);
	const [allowAnyAddress, setAllowAny] = React.useState(settings.allowAnyAddress);
	const [invalid, setInvalid] = React.useState<string[]>([]);
	const [otherAccounts, setOtherAccounts] = React.useState(settings.otherAccounts);
	const [anyAccount, setAnyAccount] = React.useState(settings.anyAccount);
	const [refused, setRefused] = React.useState<string[]>([]);
	React.useEffect(() => setRefused(live.refusedAccounts()), []);
	const applyAddresses = () =>
		setAllowedAddresses(settings.allowedAddresses, settings.allowAnyAddress).then(setInvalid).catch(console.error);
	React.useEffect(() => void applyAddresses(), []);
	return (
		<LunaSettings>
			<LunaTextSetting
				title="Device name"
				desc="The name the phone shows. Empty: TidaLuna and the computer's name"
				value={deviceName}
				onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
					setName((settings.deviceName = e.target.value));
					afterNameTyped(() => setDeviceName(settings.deviceName).catch(console.error));
				}}
			/>
			<LunaNumberSetting
				title="Port"
				desc="The receiver takes the first free port from this one (TIDAL's own receiver and TidaLunar use 9000). The firewall must let the phone in on it. Takes effect when the plugin or TIDAL starts again"
				value={firstPort}
				min={1024}
				max={65535}
				onNumber={(num: number) => setFirstPort((settings.firstPort = num))}
			/>
			<LunaTextSetting
				title="Allowed addresses"
				desc={invalid.length === 0 ? allowedAddressesDesc : `Not understood, left out: ${invalid.join(", ")}`}
				value={allowedAddresses}
				onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
					setAddresses((settings.allowedAddresses = e.target.value));
					afterAddressesTyped(applyAddresses);
				}}
			/>
			<LunaSwitchSetting
				title="Allow any address"
				desc="Lets a connection from any address in. Only on a network you trust"
				checked={allowAnyAddress}
				onChange={(_: unknown, checked: boolean) => {
					setAllowAny((settings.allowAnyAddress = checked));
					applyAddresses();
				}}
			/>
			<LunaTextSetting
				title="Other TIDAL accounts"
				desc={
					`Only phones signed in to this computer's TIDAL account (${computerAccount() || "none signed in"}) can use the receiver, and to the accounts here: TIDAL user ids, like 123456, 234567.` +
					(refused.length === 0 ? "" : ` Refused since the receiver started: ${refused.join(", ")}`)
				}
				value={otherAccounts}
				onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
					setOtherAccounts((settings.otherAccounts = e.target.value));
				}}
			/>
			<LunaSwitchSetting
				title="Any TIDAL account"
				desc="Lets a phone signed in to any TIDAL account control the player"
				checked={anyAccount}
				onChange={(_: unknown, checked: boolean) => {
					setAnyAccount((settings.anyAccount = checked));
				}}
			/>
		</LunaSettings>
	);
};
