using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using BlazorLibrary;

var builder = WebAssemblyHostBuilder.CreateDefault(args);

// Each registration exposes a real Web Component (custom element) that can be
// used from any host: plain HTML, Vanilla JS, React, Vue, etc.
builder.RootComponents.RegisterCustomElement<Counter>("blazor-counter");
builder.RootComponents.RegisterCustomElement<DateTimeNow>("blazor-date-time-now");

await builder.Build().RunAsync();
