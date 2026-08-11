using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using BlazorLibrary;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<ReadyMarker>("#app");

await builder.Build().RunAsync();
