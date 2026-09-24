export const DOMAIN_VIDEO_BUCKET = "training-materials";
export const DOMAIN_VIDEO_PREFIX = "domain-videos";

export const DOMAIN_VIDEO_LIBRARY = {
  admin: [
    { id: "admin-project-setup", title: "Projects & Operations · Project setup", domain: "Projects & Operations", duration: "2:14", file: "admin-project-setup.mp4", summary: "Create a project, set delivery information and establish the operational starting point." },
    { id: "admin-project-tracker", title: "Projects & Operations · Project Tracker", domain: "Projects & Operations", duration: "1:34", file: "admin-project-tracker.mp4", summary: "Navigate the project tracker and review delivery progress." },
    { id: "admin-health-closeout", title: "Health Report & project close-out", domain: "Projects & Operations", duration: "0:43", file: "admin-health-closeout.mp4", summary: "Review project health and complete the close-out workflow." },
    { id: "admin-quote-pipeline", title: "Quote Pipeline", domain: "Quote Pipeline", duration: "0:36", file: "admin-quote-pipeline.mp4", summary: "Follow enquiry, proposal, review and award stages." },
    { id: "admin-staff-capacity", title: "Staff Capacity Planner", domain: "Staff Capacity Planner", duration: "0:56", file: "admin-staff-capacity.mp4", summary: "Review capacity and use allocation information safely." },
    { id: "admin-portal-management", title: "Portal Management", domain: "Portal Management", duration: "1:20", file: "admin-portal-management.mp4", summary: "Navigate staff, roles, visibility and controlled portal settings." },
    { id: "admin-whs-compliance", title: "WHS & Compliance", domain: "WHS & Compliance", duration: "1:04", file: "admin-whs-compliance.mp4", summary: "Use WHS monitoring and internal governance workflows." },
    { id: "admin-service-requests", title: "Service Requests", domain: "Service Requests", duration: "0:40", file: "admin-service-requests.mp4", summary: "Review, action and track staff service requests." },
    { id: "admin-regulatory-watch", title: "Regulatory Watch", domain: "Regulatory Watch", duration: "0:38", file: "admin-regulatory-watch.mp4", summary: "Review source updates before operational changes are released." },
    { id: "admin-species-profiles", title: "Species Profiles", domain: "Species Profiles", duration: "0:45", file: "admin-species-profiles.mp4", summary: "Navigate controlled species reference and survey requirements." },
  ],
  staff: [
    { id: "staff-home-noticeboard", title: "Staff Home & Noticeboard", domain: "Staff Home", duration: "1:29", file: "staff-home-noticeboard.mp4", summary: "Find your start page, key notices and domain navigation." },
    { id: "staff-project-setup", title: "Projects & Operations · Project setup", domain: "My Projects", duration: "2:16", file: "staff-project-setup.mp4", summary: "Understand how the project delivery workspace is organised." },
    { id: "staff-my-projects-tracker", title: "My Projects & Project Tracker", domain: "My Projects", duration: "1:11", file: "staff-my-projects-tracker.mp4", summary: "View allocated work, update activity status and use the tracker." },
    { id: "staff-learning-development", title: "Learning & Development", domain: "Learning & Development", duration: "0:20", file: "staff-learning-development.mp4", summary: "Open Core Training quizzes and your approved learning material." },
    { id: "staff-whs-ec-forms", title: "WHS & EC Forms", domain: "WHS & EC Forms", duration: "0:48", file: "staff-whs-ec-forms.mp4", summary: "Find and use staff forms, requests and governance tools." },
    { id: "staff-species-profiles", title: "Species Profiles", domain: "Species Profiles", duration: "1:21", file: "staff-species-profiles.mp4", summary: "Search references and understand the profile workflow." },
    { id: "staff-workload-requests", title: "Workload Calendar & Service Requests", domain: "Staff support", duration: "0:57", file: "staff-workload-requests.mp4", summary: "Review workload information and submit or follow service requests." },
  ],
};

export function videoObjectPath(audience, file) {
  return `${DOMAIN_VIDEO_PREFIX}/${audience}/${file}`;
}
