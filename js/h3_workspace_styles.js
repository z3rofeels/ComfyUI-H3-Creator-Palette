let installed=false;
export function installH3WorkspaceStyles(){
  if(installed)return;installed=true;
  if(document.querySelector('link[data-z3-h3-workspace-css="1"]'))return;
  const link=document.createElement("link");
  link.rel="stylesheet";
  link.href=new URL("./css/h3_creator_workspace.css",import.meta.url).href;
  link.dataset.z3H3WorkspaceCss="1";
  document.head.append(link);
}
