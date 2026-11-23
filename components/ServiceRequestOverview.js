import { getServiceRequestOverview } from "../lib/serviceRequestOverview.mjs";

export default function ServiceRequestOverview({ request, staffName }) {
  const { fields, additionalDetails } = getServiceRequestOverview(request, staffName);

  return (
    <>
      <dl className="service-request-overview">
        {fields.map(({ label, value, note }) => (
          <div className="service-request-overview-field" key={label}>
            <dt>{label}</dt>
            <dd>{value}{note ? <small>{note}</small> : null}</dd>
          </div>
        ))}
      </dl>
      {additionalDetails.length ? (
        <details className="service-request-extra">
          <summary>Other request details</summary>
          <dl>
            {additionalDetails.map(({ key, label, value }) => (
              <div key={key}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        </details>
      ) : null}
    </>
  );
}
